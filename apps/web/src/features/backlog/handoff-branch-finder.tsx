import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  RiAddLine as CreateIcon,
  RiCheckLine as CheckIcon,
  RiFolderLine as MainFolderIcon,
  RiGitBranchLine as BranchIcon,
  RiHistoryLine as WorktreeIcon,
  RiSearchLine as SearchIcon,
} from "@remixicon/react";
import type { RepositoryBranch, Worktree } from "@ajour/shared/worktrees";

import { Chip } from "@/components/ui/chip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { getBranchNameRefusal } from "@/domain/handoffs/start-in";
import { cn } from "@/lib/utils";

/**
 * What a row of the finder stands for: a branch to start a new worktree
 * from, the typed text as a new branch's name, one of the item's worktrees,
 * or the main folder.
 */
export type FinderChoice =
  | { kind: "branch"; name: string }
  // The folder's default source, where its list can't name it.
  | { kind: "default" }
  | { kind: "name"; name: string }
  | { kind: "worktree"; worktreeId: string }
  | { kind: "main" };

/** A choice as one string, to tell rows apart. */
export function finderKey(choice: FinderChoice): string {
  if (choice.kind === "branch") return `branch:${choice.name}`;
  if (choice.kind === "default") return "default";
  if (choice.kind === "name") return `name:${choice.name}`;
  if (choice.kind === "worktree") return `worktree:${choice.worktreeId}`;
  return "main";
}

/** More branch rows than this would slow a repository with thousands. */
const MAX_BRANCH_ROWS = 100;

interface Row {
  key: string;
  choice: FinderChoice;
  group: string;
  /** Why the row can't be chosen, shown on its second line. */
  refusal?: string;
}

interface BranchFinderProps {
  /** The field's accessible name. */
  label: string;
  placeholder: string;
  /** The repository folder's name, for the branch checked out in it. */
  folderName: string;
  branches: readonly RepositoryBranch[];
  /** The heading over the branches, such as "New worktree from". */
  branchesHeading?: string;
  /**
   * Adds a first branch row, "Default branch", for a folder whose list
   * names no default source: the start picks it, so the row names none.
   */
  unnamedDefault?: boolean;
  /** The item's worktrees, listed first under their own heading. */
  worktrees?: readonly Worktree[];
  /** Adds the "No worktree" group, with Main folder. */
  mainFolder?: boolean;
  /**
   * Offers the typed text as a new branch's name while no branch has it:
   * a first row "<verb> <name>". `after` sits on that row's second line,
   * such as the source the new branch starts from.
   */
  naming?: { verb: string; after?: ReactNode };
  /** The row that shows a check: the choice in force. */
  checked?: FinderChoice;
  /** The row highlighted while the field is empty. Defaults to `checked`. */
  initial?: FinderChoice;
  /**
   * With it the host holds the highlighted row as its own pick: a click
   * moves it and only Enter chooses. Without it a click chooses too.
   */
  active?: FinderChoice;
  onActiveChange?: (choice: FinderChoice | undefined) => void;
  /** Enter on the highlighted row, or a click when the host holds no pick. */
  onChoose: (choice: FinderChoice) => void;
  /** A line under the rows, such as why the folder lists no branch. */
  note?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The branch finder (#861): one field over a list of a repository folder's
 * branches. Typing filters the list, and with `naming` also names a new
 * branch. The hand-off sheet's bottom line, Review prompt's right button
 * and the Start in dialog's "from" select show it with branches only. The
 * Start in dialog itself adds the item's worktrees and the main folder.
 *
 * The field keeps the focus: the arrows move the highlight, Enter chooses,
 * and every other key but Escape and Tab stays here, so a menu around the
 * finder never reads the typed letters.
 */
export function BranchFinder({
  label,
  placeholder,
  folderName,
  branches,
  branchesHeading,
  unnamedDefault = false,
  worktrees = [],
  mainFolder = false,
  naming,
  checked,
  initial = checked,
  active: heldActive,
  onActiveChange,
  onChoose,
  note,
  autoFocus,
  disabled,
  className,
}: BranchFinderProps) {
  const listId = useId();
  const [text, setText] = useState("");
  const [ownActive, setOwnActive] = useState<string | undefined>(
    initial ? finderKey(initial) : undefined,
  );
  const held = onActiveChange !== undefined;
  const typed = text.trim();
  const query = typed.toLowerCase();

  const { rows, hidden } = useMemo(() => {
    const matches = (...values: string[]) =>
      !query || values.some((value) => value.toLowerCase().includes(query));
    const seen = new Set<string>();
    const found = branches.filter((branch) => {
      // A local branch named as a remote's shows once.
      if (seen.has(branch.name) || !matches(branch.name)) return false;
      seen.add(branch.name);
      return true;
    });
    const rows: Row[] = [];
    if (naming && typed && !branches.some((branch) => branch.name === typed))
      rows.push({
        key: finderKey({ kind: "name", name: typed }),
        choice: { kind: "name", name: typed },
        group: "New branch",
        refusal: getBranchNameRefusal(typed),
      });
    for (const worktree of worktrees)
      if (matches(worktree.name, worktree.branch))
        rows.push({
          key: finderKey({ kind: "worktree", worktreeId: worktree.id }),
          choice: { kind: "worktree", worktreeId: worktree.id },
          group:
            worktrees.length > 1
              ? "This item's worktrees"
              : "This item's worktree",
        });
    if (unnamedDefault && matches("Default branch"))
      rows.push({
        key: "default",
        choice: { kind: "default" },
        group: branchesHeading ?? "",
      });
    for (const branch of found.slice(0, MAX_BRANCH_ROWS))
      rows.push({
        key: finderKey({ kind: "branch", name: branch.name }),
        choice: { kind: "branch", name: branch.name },
        group: branchesHeading ?? "",
      });
    if (mainFolder && matches("Main folder", folderName))
      rows.push({
        key: "main",
        choice: { kind: "main" },
        group: "No worktree",
      });
    return { rows, hidden: Math.max(0, found.length - MAX_BRANCH_ROWS) };
  }, [
    branches,
    branchesHeading,
    folderName,
    mainFolder,
    naming,
    query,
    typed,
    unnamedDefault,
    worktrees,
  ]);

  const wanted = held
    ? heldActive
      ? finderKey(heldActive)
      : undefined
    : ownActive;
  // A highlight the list no longer holds falls back to its first row.
  const activeRow = rows.find((row) => row.key === wanted) ?? rows[0];
  const activeIndex = activeRow ? rows.indexOf(activeRow) : -1;

  const highlight = (row: Row | undefined) => {
    if (held) onActiveChange(row?.choice);
    else setOwnActive(row?.key);
  };

  // The host's pick follows the list: when the row it held is filtered
  // out, the first row left takes its place.
  const heldKey = heldActive ? finderKey(heldActive) : undefined;
  const activeKey = activeRow?.key;
  const follow = useRef(onActiveChange);
  follow.current = onActiveChange;
  useEffect(() => {
    if (held && activeKey !== heldKey) follow.current?.(activeRow?.choice);
    // `activeRow` is the row of `activeKey`.
  }, [held, activeKey, heldKey]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeKey) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const choose = (row: Row | undefined) => {
    if (!row || row.refusal || disabled) return;
    onChoose(row.choice);
  };

  const branchOf = (name: string) =>
    branches.find((branch) => branch.name === name);
  const worktreeOf = (id: string) =>
    worktrees.find((worktree) => worktree.id === id);
  const checkedKey = checked ? finderKey(checked) : undefined;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const groups: { heading: string; rows: { row: Row; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const last = groups.at(-1);
    if (last && last.heading === row.group) last.rows.push({ row, index });
    else groups.push({ heading: row.group, rows: [{ row, index }] });
  });

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1", className)}
      onKeyDown={(event) => {
        // A menu around the finder would read letters as its own search
        // and the arrows as its own moves.
        if (event.key !== "Escape" && event.key !== "Tab")
          event.stopPropagation();
      }}
    >
      <InputGroup className="h-8">
        <InputGroupAddon align="inline-start" aria-hidden="true">
          <SearchIcon className="size-4 text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            // Typing starts again from the top; an empty field goes back to
            // the row it opened on.
            const reopened = next.trim() ? undefined : initial;
            if (held) onActiveChange(reopened);
            else setOwnActive(reopened ? finderKey(reopened) : undefined);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!rows.length) return;
              const step = event.key === "ArrowDown" ? 1 : -1;
              highlight(
                rows[
                  Math.min(rows.length - 1, Math.max(0, activeIndex + step))
                ],
              );
            } else if (event.key === "Enter") {
              // Never the form around the field: the row decides.
              event.preventDefault();
              choose(activeRow);
            }
          }}
        />
      </InputGroup>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        className="flex max-h-64 min-w-0 flex-col overflow-x-hidden overflow-y-auto"
      >
        {groups.map((group) => (
          <div
            key={group.heading}
            role="group"
            aria-label={group.heading || undefined}
            className="flex min-w-0 flex-col"
          >
            {group.heading ? (
              <div
                aria-hidden="true"
                className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground"
              >
                {group.heading}
              </div>
            ) : null}
            {group.rows.map(({ row, index }) => {
              const isActive = row.key === activeKey;
              const { choice } = row;
              const branch =
                choice.kind === "branch" ? branchOf(choice.name) : undefined;
              const worktree =
                choice.kind === "worktree"
                  ? worktreeOf(choice.worktreeId)
                  : undefined;
              return (
                <div
                  key={row.key}
                  className={cn(
                    "flex min-h-7 min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-[var(--hover-bg)]",
                    // The naming row keeps its extra control on a second line.
                    choice.kind === "name" && "flex-col items-stretch gap-1",
                    isActive && "bg-accent text-accent-foreground",
                  )}
                  data-active={isActive ? "true" : undefined}
                >
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={held ? isActive : row.key === checkedKey}
                    aria-disabled={row.refusal ? "true" : undefined}
                    className="flex min-w-0 flex-1 cursor-default items-center gap-2"
                    // The field keeps the focus, so typing goes on.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (held) highlight(row);
                      else choose(row);
                    }}
                  >
                    {choice.kind === "name" ? (
                      <CreateIcon
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                    ) : choice.kind === "worktree" ? (
                      <WorktreeIcon
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                    ) : choice.kind === "main" ? (
                      <MainFolderIcon
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                    ) : (
                      <BranchIcon
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      {choice.kind === "name" ? (
                        <span className="truncate">
                          {naming?.verb}{" "}
                          <span className="font-mono text-xs">
                            {choice.name}
                          </span>
                        </span>
                      ) : choice.kind === "worktree" ? (
                        <>
                          <span className="truncate font-mono text-xs">
                            {worktree?.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {worktree?.branch}
                          </span>
                        </>
                      ) : choice.kind === "main" ? (
                        <>
                          <span className="truncate">Main folder</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {folderName}
                          </span>
                        </>
                      ) : choice.kind === "default" ? (
                        <span className="truncate">Default branch</span>
                      ) : (
                        <span
                          className="truncate font-mono text-xs"
                          title={choice.name}
                        >
                          {choice.name}
                        </span>
                      )}
                      {row.refusal ? (
                        <span className="truncate text-xs text-destructive">
                          {row.refusal}
                        </span>
                      ) : null}
                    </span>
                    {choice.kind === "name" && isActive && !row.refusal ? (
                      <span
                        aria-hidden="true"
                        className="text-xs text-muted-foreground touch-or-narrow:hidden"
                      >
                        ↵
                      </span>
                    ) : null}
                    {branch?.default ? <Chip>default</Chip> : null}
                    {branch?.current ? (
                      <Chip className="max-w-28">in {folderName}</Chip>
                    ) : null}
                    {!held && row.key === checkedKey ? (
                      <CheckIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </div>
                  {choice.kind === "name" && !row.refusal && naming?.after ? (
                    <div className="flex min-w-0 pl-6">{naming.after}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {hidden ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {hidden} more. Type to find one.
          </p>
        ) : null}
        {!rows.length ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {note ?? "No branch found."}
          </p>
        ) : note ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{note}</p>
        ) : null}
      </div>
    </div>
  );
}
