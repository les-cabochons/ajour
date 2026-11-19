import { useEffect, useRef, useState } from "react";
import {
  fillHandoffTemplates,
  handoffTemplateDefaults,
  isValidHandoffBranch,
  type HandoffTemplates,
} from "@ajour/shared/handoff-templates";
import type { HandoffThreadOffer } from "@ajour/shared/handoff-threads";
import {
  handoffStartRefusalSchema,
  type HandoffStartRefusal,
} from "@ajour/shared/handoffs";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RepositoryPicker } from "@/components/repository-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  showActionToast,
  showErrorToast,
  showToast,
  UNDO_TOAST_TIMEOUT_MS,
} from "@/components/ui/toast";
import {
  getHandoffItem,
  getHandoffItemKeys,
  getHandoffItemRefusal,
  getHandoffProjectName,
  getHandoffToolRefusal,
  type HandoffTool,
} from "@/domain/handoffs/handoffs";
import { repositoryFolderSelection } from "@/domain/projects/repository-folders";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  AppApiError,
  adoptHandoffThread,
  dismissHandoffThread,
  findHandoffThreads,
  getHandoffTemplates,
  listRepositoryFolders,
  openHandoff,
  refreshHandoffs,
  removeHandoff,
  startHandoff,
} from "@/lib/app-api";
import { setHandoffs, upsertHandoff } from "@/lib/handoffs";
import {
  getHandoffTools,
  getHandoffToolsChoiceNow,
  hasSeenHandoffNotice,
  markHandoffNoticeSeen,
  setLastHandoffTool,
} from "@/lib/handoff-tools";
import { localStore } from "@/lib/local-store";
import {
  isHandoffStarting,
  listenForChooseHandoffTools,
  listenForHandoffRequests,
  setHandoffStarting,
} from "@/features/backlog/handoff-request";
import { useOpenSettings } from "@/features/settings/settings-link";
import { settingsLocationOf } from "@/features/settings/settings-location";

/**
 * Hand off to a coding tool, from "Hand off to a coding tool" in
 * docs/agents/ux-spec.md. Every surface asks through `requestHandoff`
 * (`handoff-request.ts`): the
 * item page's split button, the row menus and the command palette. The one
 * `HandoffHost`, mounted in the app shell, shows the first-time notice, the
 * repository picker and the Review prompt dialog, starts the thread and
 * says how it went.
 */

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Opens the thread: its link through the plugin's declared scheme or https,
 * else its resume command in a terminal. A refusal shows in the tool's or
 * the setting's words.
 */
export async function openHandoffThread(handoffId: string) {
  try {
    await openHandoff(handoffId);
  } catch (error) {
    showErrorToast({
      title: "Couldn't open the thread",
      description: errorMessage(error, "The tool didn't answer."),
    });
  }
}

interface Job {
  /** One per accepted request. A dialog's edits, such as its folder, keep it. */
  id: number;
  tool: HandoffTool;
  item: LocalWorkItem;
  projectId: string;
  review: boolean;
  folder?: RepositoryFolder;
}

/**
 * What one start sends besides the item: Review prompt's prompt and branch,
 * and the tool settings the user gave when the tool refused one (#819).
 */
interface StartEdits {
  promptOverride?: string;
  branchOverride?: string;
  settings?: Record<string, string>;
}

type RefusedSetting = NonNullable<HandoffStartRefusal["setting"]>;

type Step =
  | { kind: "idle" }
  | { kind: "notice"; job: Job }
  | { kind: "picker"; job: Job }
  | { kind: "review"; job: Job }
  // The branch exists, and the tool lists the item's thread (#819).
  | { kind: "link"; job: Job; offer: HandoffThreadOffer }
  // The tool refused one of its settings: ask for it, then start again.
  | {
      kind: "setting";
      job: Job;
      folder: RepositoryFolder;
      edits: StartEdits;
      reason: string;
      setting: RefusedSetting;
    };

const IDLE: Step = { kind: "idle" };

const jobOf = (step: Step) => (step.kind === "idle" ? undefined : step.job);

let nextJobId = 0;

/** The job's item as the store holds it now. */
function currentItem(job: Job) {
  return (
    localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === job.item._id) ?? job.item
  );
}

async function start(
  job: Job,
  folder: RepositoryFolder,
  edits: StartEdits = {},
) {
  const { tool, projectId } = job;
  const { settings = {}, ...overrides } = edits;
  const state = localStore.snapshot();
  const current = currentItem(job);
  const record = await startHandoff({
    pluginId: tool.pluginId,
    toolId: tool.toolId,
    folderId: folder.id,
    projectId,
    workItemId: current._id,
    projectName: getHandoffProjectName(current, state.projects),
    item: getHandoffItem(current, state.workItems),
    ...overrides,
    settings,
  });
  upsertHandoff(record);
  setLastHandoffTool(tool.key);
  // No Undo: the thread already runs in the tool.
  showActionToast({
    title: `Handed off to ${tool.label}`,
    actionLabel: "Open",
    onAction: () => void openHandoffThread(record.id),
    timeout: UNDO_TOAST_TIMEOUT_MS,
  });
}

function showStartError(job: Job, error: unknown) {
  showErrorToast({
    title: `Couldn't hand off to ${job.tool.label}`,
    description: errorMessage(error, "The tool refused the hand off."),
  });
}

/** What a refused start's answer says the window can do, if anything. */
function refusalOf(error: unknown): HandoffStartRefusal | undefined {
  if (!(error instanceof AppApiError) || error.status !== 409) return undefined;
  const parsed = handoffStartRefusalSchema.safeParse(error.payload);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The dialog a refused start leads to (#819): the tool's setting it refused,
 * to ask for it, or, when the branch exists, the item's thread that the same
 * tool lists, to link it. Undefined when there is none: the refusal then
 * shows as it is.
 */
async function followUpOf(
  job: Job,
  folder: RepositoryFolder,
  edits: StartEdits,
  error: unknown,
): Promise<Step | undefined> {
  const refusal = refusalOf(error);
  if (refusal?.setting)
    return {
      kind: "setting",
      job,
      folder,
      edits,
      reason: refusal.error,
      setting: refusal.setting,
    };
  if (!refusal?.branchExists) return undefined;
  const item = currentItem(job);
  const keys = getHandoffItemKeys(item);
  if (!keys.length) return undefined;
  try {
    const { offers } = await findHandoffThreads(job.projectId, item._id, keys);
    const offer = offers.find(
      (candidate) =>
        candidate.pluginId === job.tool.pluginId &&
        candidate.toolId === job.tool.toolId,
    );
    return offer ? { kind: "link", job, offer } : undefined;
  } catch {
    return undefined;
  }
}

export function HandoffHost() {
  const [step, setStep] = useState<Step>(IDLE);
  /**
   * Every accepted job holds its item's starting flag until it ends: its
   * thread starts, its lookup or start fails, the user closes its dialog, or
   * another job's dialog replaces it. A job whose lookup or start still runs
   * ends when that settles. Each end is decided where it happens, never read
   * back from what rendered, so batched dialogs and unmounting lose none.
   */
  const owners = useRef(new Map<string, number>());
  /** Jobs with a folder lookup or a start running. */
  const running = useRef(new Set<number>());
  /** The step last shown, ahead of the render that shows it. */
  const shown = useRef<Step>(IDLE);
  const mounted = useRef(false);

  const release = (job: Job) => {
    if (owners.current.get(job.item._id) !== job.id) return;
    owners.current.delete(job.item._id);
    setHandoffStarting(job.item._id, false);
  };
  const isShown = (job: Job) => jobOf(shown.current)?.id === job.id;
  /** Shows a step. The job it replaces ends, unless something of it runs. */
  const show = (next: Step) => {
    const before = jobOf(shown.current);
    const after = jobOf(next);
    if (mounted.current) {
      shown.current = next;
      setStep(next);
    } else if (after) release(after);
    if (before && before.id !== after?.id && !running.current.has(before.id))
      release(before);
  };
  /** A job's lookup or start has settled; it ends unless a dialog shows it. */
  const settle = (job: Job) => {
    running.current.delete(job.id);
    if (!isShown(job)) release(job);
  };

  useEffect(() => {
    mounted.current = true;
    const ownersNow = owners.current;
    const runningNow = running.current;
    return () => {
      mounted.current = false;
      shown.current = IDLE;
      // A job with nothing running ends with the host. One whose lookup or
      // start runs ends when that settles.
      for (const [itemId, id] of [...ownersNow])
        if (!runningNow.has(id)) {
          ownersNow.delete(itemId);
          setHandoffStarting(itemId, false);
        }
    };
  }, []);

  /**
   * Shows the dialog a refused start leads to. A start from a dialog shows
   * it only while that dialog still shows, so one the user closed while the
   * start or the thread lookup ran stays closed. A start in the background
   * shows it unless another job's dialog shows. True when it showed one;
   * the caller says why otherwise.
   */
  async function showFollowUp(
    job: Job,
    folder: RepositoryFolder,
    edits: StartEdits,
    error: unknown,
    fromDialog: boolean,
  ) {
    const next = await followUpOf(job, folder, edits, error);
    if (!next || !mounted.current) return false;
    const free = fromDialog
      ? isShown(job)
      : shown.current.kind === "idle" || isShown(job);
    if (!free) return false;
    show(next);
    return true;
  }

  async function startInBackground(job: Job, folder: RepositoryFolder) {
    running.current.add(job.id);
    try {
      await start(job, folder);
    } catch (error) {
      if (!(await showFollowUp(job, folder, {}, error, false)))
        showStartError(job, error);
    } finally {
      settle(job);
    }
  }

  /** A project with one folder starts at once; none or several ask which. */
  async function proceed(job: Job) {
    if (job.review) {
      show({ kind: "review", job });
      return;
    }
    running.current.add(job.id);
    let folders: RepositoryFolder[];
    try {
      folders = await listRepositoryFolders(job.projectId);
    } catch (error) {
      showErrorToast({
        title: `Couldn't hand off to ${job.tool.label}`,
        description: errorMessage(error, "Could not load folders."),
      });
      settle(job);
      return;
    }
    running.current.delete(job.id);
    if (folders.length === 1) {
      await startInBackground(job, folders[0]!);
      return;
    }
    show({ kind: "picker", job });
  }

  /**
   * Review prompt's Start. The item stays starting until the start settles,
   * even if the dialog closes first, and only this job's dialog closes.
   */
  async function startReviewed(
    job: Job,
    folder: RepositoryFolder,
    edits: StartEdits,
  ) {
    running.current.add(job.id);
    try {
      await start(job, folder, edits);
    } catch (error) {
      // A refusal the window can act on replaces the dialog (#819).
      if (await showFollowUp(job, folder, edits, error, true)) return;
      // A closed dialog can't show the refusal, so a toast does.
      if (!isShown(job)) showStartError(job, error);
      throw error;
    } finally {
      settle(job);
    }
    if (isShown(job)) show(IDLE);
  }

  const openSettings = useOpenSettings();
  // No tool is on: the plugin's tool list, or the plugins list when several
  // plugins hand off (`getHandoffToolsChoice`).
  useEffect(
    () =>
      listenForChooseHandoffTools(() => {
        const choice = getHandoffToolsChoiceNow();
        void openSettings(
          settingsLocationOf(choice?.page ?? "plugins", choice?.search),
        );
      }),
    [openSettings],
  );

  useEffect(() => {
    return listenForHandoffRequests((request) => {
      // One hand off per item at a time, whichever surface asks again.
      if (isHandoffStarting(request.itemId)) return;
      const tool = getHandoffTools().find(
        (candidate) => candidate.key === request.toolKey,
      );
      const item = localStore
        .snapshot()
        .workItems.find((candidate) => candidate._id === request.itemId);
      if (!tool || !item) return;
      const refusal =
        getHandoffItemRefusal(item) ?? getHandoffToolRefusal(tool);
      if (refusal || !item.projectId) {
        showErrorToast({
          title: `Couldn't hand off to ${tool.label}`,
          description: refusal,
        });
        return;
      }
      const job: Job = {
        id: ++nextJobId,
        tool,
        item,
        projectId: item.projectId,
        review: Boolean(request.review),
      };
      owners.current.set(item._id, job.id);
      setHandoffStarting(item._id, true);
      if (!hasSeenHandoffNotice(tool.key)) {
        show({ kind: "notice", job });
        return;
      }
      void proceed(job);
    });
    // The listener reads only refs and setters, so the first one serves.
  }, []);

  /** Closes the dialog of `kind` if it still shows. */
  const dismiss = (kind: Step["kind"]) => {
    if (shown.current.kind === kind) show(IDLE);
  };
  const job = jobOf(step);
  return (
    <>
      <ConfirmDialog
        open={step.kind === "notice"}
        // The dialogs' close callbacks run after their actions, so each
        // dismissal reads the step its action left.
        onOpenChange={(open) => {
          if (!open) dismiss("notice");
        }}
        question={
          job
            ? {
                title: `Hand off to ${job.tool.label}?`,
                body: `${job.tool.label} receives this item's title, description and link, and sends them to its model provider. Ajour itself sends them nowhere else. This shows once per tool.`,
                action: "Hand off",
              }
            : null
        }
        onConfirm={() => {
          const current = shown.current;
          if (current.kind !== "notice") return;
          markHandoffNoticeSeen(current.job.tool.key);
          // The job goes on to its lookup, so closing the notice keeps it.
          running.current.add(current.job.id);
          show(IDLE);
          running.current.delete(current.job.id);
          void proceed(current.job);
        }}
      />
      <RepositoryPicker
        projectId={job?.projectId ?? ""}
        open={step.kind === "picker"}
        onOpenChange={(open) => {
          const current = shown.current;
          if (open || current.kind !== "picker") return;
          // Closing the picker from the review dialog returns to it.
          show(
            current.job.review ? { kind: "review", job: current.job } : IDLE,
          );
        }}
        onSelect={(folder) => {
          const current = shown.current;
          if (current.kind !== "picker") return;
          const picked = current.job;
          if (picked.review) {
            show({ kind: "review", job: { ...picked, folder } });
            return;
          }
          // The start runs from here, so closing the picker keeps the job.
          running.current.add(picked.id);
          show(IDLE);
          void startInBackground(picked, folder);
        }}
      />
      <Dialog
        open={step.kind === "review"}
        onOpenChange={(open) => {
          if (!open) dismiss("review");
        }}
      >
        {step.kind === "review" ? (
          <ReviewPromptContent
            key={step.job.id}
            job={step.job}
            onChooseFolder={(folder) =>
              show({ kind: "picker", job: { ...step.job, folder } })
            }
            onFolder={(folder) =>
              show({ kind: "review", job: { ...step.job, folder } })
            }
            onStart={(folder, overrides) =>
              startReviewed(step.job, folder, overrides)
            }
            onCancel={() => dismiss("review")}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={step.kind === "link"}
        onOpenChange={(open) => {
          if (!open) dismiss("link");
        }}
        question={
          step.kind === "link"
            ? {
                title: "Link the existing thread?",
                body: `${step.job.tool.label} already has this item's branch, in the thread "${step.offer.title}". Link that thread to the item instead of starting another.`,
                action: "Link thread",
              }
            : null
        }
        onConfirm={() => {
          const current = shown.current;
          if (current.kind !== "link") return;
          void linkHandoffThread(current.offer, {
            workItemId: current.job.item._id,
            projectId: current.job.projectId,
          }).then((linked) => {
            if (linked)
              showToast(`Linked the thread in ${current.job.tool.label}.`);
          });
        }}
      />
      <Dialog
        open={step.kind === "setting"}
        onOpenChange={(open) => {
          if (!open) dismiss("setting");
        }}
      >
        {step.kind === "setting" ? (
          <RefusedSettingContent
            key={`${step.job.id}:${step.setting.id}:${step.reason}`}
            step={step}
            onStart={(value) =>
              startReviewed(step.job, step.folder, {
                ...step.edits,
                settings: { ...step.edits.settings, [step.setting.id]: value },
              })
            }
            onCancel={() => dismiss("setting")}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * The tool refused one of its settings (#819), such as a worktree base the
 * repository doesn't have: its reason, then the setting as its manifest
 * names it, filled with the value refused. Hand off starts again with the
 * answer, which Ajour keeps for the folder once the tool takes it.
 */
function RefusedSettingContent({
  step,
  onStart,
  onCancel,
}: {
  step: Extract<Step, { kind: "setting" }>;
  onStart: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { job, folder, reason, setting } = step;
  const [value, setValue] = useState(setting.value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canStart = Boolean(value.trim()) && !busy;
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Hand off to {job.tool.label}</DialogTitle>
        <DialogDescription>{reason}</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canStart) return;
          setBusy(true);
          setError("");
          void onStart(value.trim())
            .catch((failure: unknown) =>
              setError(errorMessage(failure, "The tool refused the hand off.")),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Field>
          <FieldLabel htmlFor="handoff-setting">{setting.label}</FieldLabel>
          <Input
            id="handoff-setting"
            className="font-mono"
            value={value}
            disabled={busy}
            autoFocus
            aria-describedby="handoff-setting-description"
            onChange={(event) => setValue(event.target.value)}
          />
          <FieldDescription id="handoff-setting-description">
            {setting.helpText ? `${setting.helpText} ` : ""}
            Ajour uses it for the next hand offs from {folder.name}.
          </FieldDescription>
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canStart}>
            Hand off
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * Review prompt…: the filled prompt, the folder and the branch, each
 * editable, before Start. The prompt goes as `promptOverride`; the branch as
 * `branchOverride`, empty for no worktree. Until the user edits them, both
 * follow the chosen folder, which `{{repo.name}}` may name.
 */
function ReviewPromptContent({
  job,
  onChooseFolder,
  onFolder,
  onStart,
  onCancel,
}: {
  job: Job;
  onChooseFolder: (current: RepositoryFolder | undefined) => void;
  onFolder: (folder: RepositoryFolder) => void;
  onStart: (
    folder: RepositoryFolder,
    overrides: { promptOverride: string; branchOverride: string },
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const { tool, item, projectId, folder } = job;
  const [templates, setTemplates] = useState<HandoffTemplates>();
  const [loadError, setLoadError] = useState("");
  const [prompt, setPrompt] = useState<string>();
  const [branch, setBranch] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void getHandoffTemplates(tool.pluginId)
      .then((value) => {
        if (live) setTemplates(value);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(errorMessage(error, "Could not load the templates."));
        setTemplates(handoffTemplateDefaults());
      });
    return () => {
      live = false;
    };
  }, [tool.pluginId]);

  // The last used folder, unless the user picked one.
  useEffect(() => {
    if (folder) return;
    let live = true;
    void listRepositoryFolders(projectId)
      .then((folders) => {
        const id = repositoryFolderSelection(folders, "");
        const found = folders.find((candidate) => candidate.id === id);
        if (live && found) onFolder(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // `onFolder` changes every render; the folder list is per project.
  }, [folder, projectId]);

  const state = localStore.snapshot();
  const filled = templates
    ? fillHandoffTemplates(templates, {
        item: getHandoffItem(item, state.workItems),
        projectName: getHandoffProjectName(item, state.projects),
        repoName: folder?.name ?? "",
      })
    : undefined;
  const promptValue = prompt ?? filled?.prompt ?? "";
  const branchValue = branch ?? filled?.branch ?? "";
  const branchError =
    branchValue && !isValidHandoffBranch(branchValue)
      ? "Not a valid git branch name."
      : "";
  const canStart =
    Boolean(folder && templates && promptValue.trim()) && !branchError && !busy;

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Hand off to {tool.label}</DialogTitle>
        <DialogDescription>{item.title}</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canStart || !folder) return;
          setBusy(true);
          setError("");
          void onStart(folder, {
            promptOverride: promptValue,
            branchOverride: branchValue,
          })
            .catch((error: unknown) =>
              setError(errorMessage(error, "The tool refused the hand off.")),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Field>
          <FieldLabel htmlFor="handoff-prompt">Prompt</FieldLabel>
          <Textarea
            id="handoff-prompt"
            rows={10}
            className="max-h-[50vh] font-mono text-xs"
            value={promptValue}
            disabled={!templates || busy}
            onChange={(event) => setPrompt(event.target.value)}
          />
          {loadError ? (
            <FieldDescription role="alert" className="text-destructive">
              {loadError} The default template is shown.
            </FieldDescription>
          ) : null}
        </Field>
        <Field>
          <FieldLabel id="handoff-folder-label">Folder</FieldLabel>
          <div
            className="flex min-h-8 items-center gap-3"
            aria-labelledby="handoff-folder-label"
            role="group"
          >
            <span className="min-w-0 flex-1">
              {folder ? (
                <>
                  <span className="block truncate text-sm">{folder.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {folder.path}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No folder chosen
                </span>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onChooseFolder(folder)}
            >
              {folder ? "Change…" : "Choose folder…"}
            </Button>
          </div>
        </Field>
        <Field data-invalid={Boolean(branchError) || undefined}>
          <FieldLabel htmlFor="handoff-branch">Branch</FieldLabel>
          <Input
            id="handoff-branch"
            className="font-mono"
            value={branchValue}
            disabled={!templates || busy}
            aria-invalid={Boolean(branchError) || undefined}
            aria-describedby="handoff-branch-description"
            onChange={(event) => setBranch(event.target.value)}
          />
          <FieldDescription
            id="handoff-branch-description"
            role={branchError ? "alert" : undefined}
            className={branchError ? "text-destructive" : undefined}
          >
            {branchError || "Leave it empty to work without a new worktree."}
          </FieldDescription>
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canStart}>
            Start
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Refresh in a handoff's menu: asks the tool for the thread's state now. */
export async function refreshHandoffThread(handoffId: string) {
  try {
    const result = await refreshHandoffs(handoffId);
    setHandoffs(result.handoffs);
    const failure = result.failures[0];
    if (failure)
      showErrorToast({
        title: "Couldn't refresh the thread",
        description: failure.reason,
      });
  } catch (error) {
    showErrorToast({
      title: "Couldn't refresh the thread",
      description: errorMessage(error, "The tool didn't answer."),
    });
  }
}

/**
 * Remove from item: Ajour forgets the thread. The thread itself stays in the
 * tool, so nothing is lost and the toast says where it is.
 */
export async function removeHandoffFromItem(
  handoffId: string,
  toolLabel: string,
) {
  try {
    setHandoffs(await removeHandoff(handoffId));
    showToast(`Removed from the item. The thread stays in ${toolLabel}.`);
  } catch (error) {
    showErrorToast({
      title: "Couldn't remove the thread",
      description: errorMessage(error, "The local API didn't answer."),
    });
  }
}

/**
 * Links a thread the tool listed to the item, as a handoff. Its state is
 * unknown until the API refreshes it, which it does before answering. A
 * refusal shows in the API's words. Resolves whether it was linked.
 */
export async function linkHandoffThread(
  offer: HandoffThreadOffer,
  item: { workItemId: string; projectId: string },
) {
  try {
    upsertHandoff(
      await adoptHandoffThread({
        pluginId: offer.pluginId,
        toolId: offer.toolId,
        ...(offer.connectionId ? { connectionId: offer.connectionId } : {}),
        folderId: offer.folderId,
        threadId: offer.threadId,
        projectId: item.projectId,
        workItemId: item.workItemId,
      }),
    );
    return true;
  } catch (error) {
    showErrorToast({
      title: "Couldn't link the thread",
      description: errorMessage(error, "The local API didn't answer."),
    });
    return false;
  }
}

/**
 * "Not this one": the thread is offered to this item no more. Other items
 * its title names still offer it.
 */
export async function dismissHandoffThreadOffer(
  offer: HandoffThreadOffer,
  workItemId: string,
) {
  try {
    await dismissHandoffThread({
      pluginId: offer.pluginId,
      toolId: offer.toolId,
      ...(offer.connectionId ? { connectionId: offer.connectionId } : {}),
      threadId: offer.threadId,
      workItemId,
    });
    return true;
  } catch (error) {
    showErrorToast({
      title: "Couldn't hide the thread",
      description: errorMessage(error, "The local API didn't answer."),
    });
    return false;
  }
}
