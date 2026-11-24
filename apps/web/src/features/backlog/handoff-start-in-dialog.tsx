import { useEffect, useId, useState } from "react";
import { RiArrowDownSLine as SelectIcon } from "@remixicon/react";
import { fillHandoffTemplates } from "@ajour/shared/handoff-templates";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import type { HandoffStartIn } from "@ajour/shared/worktrees";

import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getHandoffItem,
  getHandoffProjectName,
  type HandoffTool,
} from "@/domain/handoffs/handoffs";
import {
  getBranchNameRefusal,
  getNewWorktreeRefusal,
  summarizeStartPlace,
  type FolderStartOptions,
} from "@/domain/handoffs/start-in";
import type { LocalWorkItem } from "@/domain/local-state";
import { loadStartOptions } from "@/lib/handoff-start-options";
import { localStore } from "@/lib/local-store";
import {
  BranchFinder,
  type FinderChoice,
} from "@/features/backlog/handoff-branch-finder";
import { useHandoffTemplates } from "@/features/backlog/use-handoff-templates";

/**
 * Whether the folder takes a new worktree while no branch row stands for
 * its default source: the list names none, as in a clone that never
 * recorded its remote's default branch, or names one that is no listed
 * branch, as a detached main folder's commit. The start then picks the
 * source, so the dialog offers a "Default branch" row instead. A
 * repository that lists no branch at all, as one without a commit, has
 * nothing a new worktree could start from, and gets no such row.
 */
function lacksSourceRow(options: FolderStartOptions): boolean {
  const listed = options.branches;
  if (!listed || listed.unavailable || !listed.branches.length) return false;
  return !listed.branches.some((branch) => branch.name === listed.source);
}

/**
 * The row the dialog opens on: a new worktree from the default source, or,
 * where no branch is listed to start one from, the item's newest worktree,
 * else the main folder.
 */
function defaultPick(options: FolderStartOptions): FinderChoice {
  // No row for the source: the one that leaves it to the start.
  if (lacksSourceRow(options)) return { kind: "default" };
  const source = options.branches?.source;
  if (source && options.branches?.branches.length)
    return { kind: "branch", name: source };
  const worktree = options.worktrees[0];
  return worktree
    ? { kind: "worktree", worktreeId: worktree.id }
    : { kind: "main" };
}

/**
 * The Start in dialog (#861), shown when Start in is Ask each time and the
 * user picks a tool. One field filters the list and names a new branch.
 * The list has the item's worktrees, the branches a new worktree can start
 * from, and the main folder. Text that is no branch's name adds a first
 * row, Create <name>, with the source of the new branch on its second
 * line. A branch row means a new worktree from that branch, on the branch
 * template's name. The line above the buttons says what Hand off will do
 * with the row picked, and a refusal stays in the dialog. For a tool that
 * makes its own worktree the line says so (#863): the rows are the same,
 * and a worktree of the item counts as a new one of the tool's.
 */
export function StartInDialogContent({
  tool,
  item,
  projectId,
  folder,
  onStart,
  onCancel,
}: {
  tool: HandoffTool;
  item: LocalWorkItem;
  projectId: string;
  folder: RepositoryFolder;
  onStart: (startIn: HandoffStartIn) => Promise<void>;
  onCancel: () => void;
}) {
  const summaryId = useId();
  const { templates } = useHandoffTemplates(tool.pluginId);
  const [options, setOptions] = useState<FolderStartOptions>();
  const [picked, setPicked] = useState<FinderChoice>();
  /** The source picked for a branch the user names. */
  const [createSource, setCreateSource] = useState<string>();
  const [choosingSource, setChoosingSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void loadStartOptions(projectId, item._id, [folder]).then((loaded) => {
      const found = loaded.folders[0];
      if (!live || !found) return;
      setOptions(found);
      setPicked(defaultPick(found));
    });
    return () => {
      live = false;
    };
  }, [projectId, item._id, folder]);

  const state = localStore.snapshot();
  const templateBranch = templates
    ? fillHandoffTemplates(templates, {
        item: getHandoffItem(item, state.workItems),
        projectName: getHandoffProjectName(item, state.projects),
        repoName: folder.name,
      }).branch
    : "";
  const defaultSource = options?.branches?.source;
  const fromSource = createSource ?? defaultSource;
  const fromLabel = fromSource ?? "the default branch";

  /** What the picked row starts, as the start request says it. */
  const placeOf = (choice: FinderChoice): HandoffStartIn => {
    if (choice.kind === "main") return { kind: "main" };
    if (choice.kind === "default") return { kind: "new" };
    if (choice.kind === "worktree")
      return { kind: "worktree", worktreeId: choice.worktreeId };
    if (choice.kind === "name")
      return {
        kind: "new",
        branch: choice.name,
        ...(createSource ? { source: createSource } : {}),
      };
    // The default source is not a pick: Ajour remembers only what the user
    // chose instead of it. Where the list names no default, every branch
    // row is a pick, and is sent, so the branch shown is the one used.
    return {
      kind: "new",
      ...(choice.name === defaultSource ? {} : { source: choice.name }),
    };
  };
  const place = picked ? placeOf(picked) : undefined;
  const nameRefusal =
    picked?.kind === "name" ? getBranchNameRefusal(picked.name) : undefined;
  const summary =
    nameRefusal ??
    (place && options
      ? summarizeStartPlace(
          place,
          options,
          { branch: templateBranch },
          tool.ownWorktree ? tool.label : undefined,
        )
      : "");
  const canStart =
    Boolean(place && options && templates) && !nameRefusal && !busy;
  const unavailable = options ? getNewWorktreeRefusal(options) : undefined;

  /** Starts with the picked row, or the row Enter was pressed on. */
  const submit = (chosen = place) => {
    if (!canStart || !chosen) return;
    setBusy(true);
    setError("");
    void onStart(chosen)
      .catch((failure: unknown) =>
        setError(
          failure instanceof Error && failure.message
            ? failure.message
            : "The tool refused the hand off.",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Hand off to {tool.label}</DialogTitle>
        <DialogDescription>{item.title}</DialogDescription>
      </DialogHeader>
      <form
        className="flex min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <BranchFinder
          autoFocus
          label="Where to start"
          placeholder="Find a branch or worktree, or name a new branch…"
          folderName={folder.name}
          branches={options?.branches?.branches ?? []}
          branchesHeading="New worktree from"
          unnamedDefault={options ? lacksSourceRow(options) : false}
          worktrees={options?.worktrees}
          mainFolder={Boolean(options)}
          naming={
            unavailable
              ? undefined
              : {
                  verb: "Create",
                  after: options ? (
                    <Popover
                      open={choosingSource}
                      onOpenChange={setChoosingSource}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        from
                        <PopoverTrigger
                          render={
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="min-w-0 gap-1 px-1.5 font-mono font-normal"
                              aria-label={`Source of the new branch: ${fromLabel}`}
                              disabled={busy}
                            />
                          }
                        >
                          <span className="truncate">{fromLabel}</span>
                          <SelectIcon aria-hidden="true" className="size-3" />
                        </PopoverTrigger>
                      </span>
                      <PopoverContent
                        align="start"
                        className="w-64 gap-0 p-1.5"
                      >
                        <BranchFinder
                          autoFocus
                          label="Source of the new branch"
                          placeholder="Find a branch…"
                          folderName={folder.name}
                          branches={options?.branches?.branches ?? []}
                          checked={
                            fromSource
                              ? { kind: "branch", name: fromSource }
                              : undefined
                          }
                          onChoose={(choice) => {
                            if (choice.kind === "branch")
                              setCreateSource(choice.name);
                            setChoosingSource(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  ) : undefined,
                }
          }
          initial={options ? defaultPick(options) : undefined}
          active={picked}
          onActiveChange={setPicked}
          onChoose={(choice) => submit(placeOf(choice))}
          note={
            !options
              ? "Looking for branches…"
              : unavailable
                ? `New worktree isn't available: ${unavailable}.`
                : undefined
          }
          disabled={busy}
        />
        <p
          id={summaryId}
          role={nameRefusal ? "alert" : undefined}
          className={
            nameRefusal
              ? "h-4 truncate text-xs text-destructive"
              : "h-4 truncate text-xs text-muted-foreground"
          }
          title={summary}
        >
          {summary}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canStart}
            aria-describedby={summaryId}
          >
            Hand off
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
