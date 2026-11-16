import { useEffect, useRef, useState } from "react";
import {
  fillHandoffTemplates,
  handoffTemplateDefaults,
  isValidHandoffBranch,
  type HandoffTemplates,
} from "@ajour/shared/handoff-templates";
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
  getHandoffItemRefusal,
  getHandoffProjectName,
  getHandoffToolRefusal,
  type HandoffTool,
} from "@/domain/handoffs/handoffs";
import { repositoryFolderSelection } from "@/domain/projects/repository-folders";
import type { LocalWorkItem } from "@/domain/local-state";
import {
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
  hasSeenHandoffNotice,
  markHandoffNoticeSeen,
  setLastHandoffTool,
} from "@/lib/handoff-tools";
import { localStore } from "@/lib/local-store";
import {
  isHandoffStarting,
  listenForHandoffRequests,
  setHandoffStarting,
} from "@/features/backlog/handoff-request";

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
  tool: HandoffTool;
  item: LocalWorkItem;
  projectId: string;
  review: boolean;
  folder?: RepositoryFolder;
}

type Step =
  | { kind: "idle" }
  | { kind: "notice"; job: Job }
  | { kind: "picker"; job: Job }
  | { kind: "review"; job: Job };

const IDLE: Step = { kind: "idle" };

async function start(
  job: Job,
  folder: RepositoryFolder,
  overrides: { promptOverride?: string; branchOverride?: string } = {},
) {
  const { tool, item, projectId } = job;
  const state = localStore.snapshot();
  const current =
    state.workItems.find((candidate) => candidate._id === item._id) ?? item;
  const record = await startHandoff({
    pluginId: tool.pluginId,
    toolId: tool.toolId,
    folderId: folder.id,
    projectId,
    workItemId: current._id,
    projectName: getHandoffProjectName(current, state.projects),
    item: getHandoffItem(current, state.workItems),
    ...overrides,
    settings: {},
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

async function startWithToast(job: Job, folder: RepositoryFolder) {
  try {
    await start(job, folder);
  } catch (error) {
    showErrorToast({
      title: `Couldn't hand off to ${job.tool.label}`,
      description: errorMessage(error, "The tool refused the hand off."),
    });
  }
}

export function HandoffHost() {
  const [step, setStep] = useState<Step>(IDLE);
  /**
   * The items whose folder lookup or start runs with no dialog showing them.
   * An item stays starting from the accepted request until its thread
   * starts, the start fails, or the user cancels a dialog.
   */
  const pending = useRef(new Set<string>());
  const release = (itemId: string) => {
    pending.current.delete(itemId);
    setHandoffStarting(itemId, false);
  };

  // A dialog that closes, or gives way to another item's, ends its item's
  // hand off, unless a lookup or a start for it still runs.
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = shown.current;
    shown.current = step.kind === "idle" ? undefined : step.job.item._id;
    if (before && before !== shown.current && !pending.current.has(before))
      setHandoffStarting(before, false);
  }, [step]);

  async function startInBackground(job: Job, folder: RepositoryFolder) {
    try {
      await startWithToast(job, folder);
    } finally {
      release(job.item._id);
    }
  }

  /**
   * A project with one folder starts at once; none or several ask which.
   * The caller has marked the job's item pending.
   */
  async function proceed(job: Job) {
    const itemId = job.item._id;
    if (job.review) {
      pending.current.delete(itemId);
      setStep({ kind: "review", job });
      return;
    }
    let folders: RepositoryFolder[];
    try {
      folders = await listRepositoryFolders(job.projectId);
    } catch (error) {
      showErrorToast({
        title: `Couldn't hand off to ${job.tool.label}`,
        description: errorMessage(error, "Could not load folders."),
      });
      release(itemId);
      return;
    }
    if (folders.length === 1) {
      await startInBackground(job, folders[0]!);
      return;
    }
    pending.current.delete(itemId);
    setStep({ kind: "picker", job });
  }

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
        tool,
        item,
        projectId: item.projectId,
        review: Boolean(request.review),
      };
      setHandoffStarting(item._id, true);
      if (!hasSeenHandoffNotice(tool.key)) {
        setStep({ kind: "notice", job });
        return;
      }
      pending.current.add(item._id);
      void proceed(job);
    });
    // `proceed` reads only refs and setters, so the first one serves.
  }, []);

  const close = () => setStep(IDLE);
  const job = step.kind === "idle" ? undefined : step.job;
  return (
    <>
      <ConfirmDialog
        open={step.kind === "notice"}
        // The dialogs' close callbacks run after their actions, so each
        // step change reads the step it replaces.
        onOpenChange={(open) => {
          if (!open)
            setStep((current) => (current.kind === "notice" ? IDLE : current));
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
          if (step.kind !== "notice") return;
          markHandoffNoticeSeen(step.job.tool.key);
          pending.current.add(step.job.item._id);
          setStep(IDLE);
          void proceed(step.job);
        }}
      />
      <RepositoryPicker
        projectId={job?.projectId ?? ""}
        open={step.kind === "picker"}
        onOpenChange={(open) => {
          if (open) return;
          // Closing the picker from the review dialog returns to it.
          setStep((current) =>
            current.kind !== "picker"
              ? current
              : current.job.review
                ? { kind: "review", job: current.job }
                : IDLE,
          );
        }}
        onSelect={(folder) => {
          if (step.kind !== "picker") return;
          const picked = step.job;
          if (picked.review) {
            setStep({ kind: "review", job: { ...picked, folder } });
            return;
          }
          pending.current.add(picked.item._id);
          setStep(IDLE);
          void startInBackground(picked, folder);
        }}
      />
      <Dialog
        open={step.kind === "review"}
        onOpenChange={(open) => {
          if (!open)
            setStep((current) => (current.kind === "review" ? IDLE : current));
        }}
      >
        {step.kind === "review" ? (
          <ReviewPromptContent
            key={step.job.item._id + step.job.tool.key}
            job={step.job}
            onChooseFolder={(folder) =>
              setStep({ kind: "picker", job: { ...step.job, folder } })
            }
            onFolder={(folder) =>
              setStep({ kind: "review", job: { ...step.job, folder } })
            }
            onStart={async (folder, overrides) => {
              await start(step.job, folder, overrides);
              close();
            }}
            onCancel={close}
          />
        ) : null}
      </Dialog>
    </>
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
