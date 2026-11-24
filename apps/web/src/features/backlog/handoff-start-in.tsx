import { useRef, useState } from "react";
import {
  RiFolderLine as MainFolderIcon,
  RiGitBranchLine as BranchIcon,
  RiHistoryLine as PreviousWorktreeIcon,
  RiNodeTree as NewWorktreeIcon,
  RiQuestionLine as AskIcon,
} from "@remixicon/react";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import type { HandoffStartIn } from "@ajour/shared/worktrees";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHandoffFolderNote } from "@/domain/handoffs/handoffs";
import {
  defaultStartPlace,
  describeStartPlace,
  getNewWorktreeRefusal,
  getOwnWorktreeNote,
  getStartSource,
  getWorktreePath,
  summarizeStartPlace,
  type FolderStartOptions,
  type StartPlace,
  type StartPlaceLines,
} from "@/domain/handoffs/start-in";
import type { ProjectStartOptions } from "@/lib/handoff-start-options";
import { cn } from "@/lib/utils";
import { BranchFinder } from "@/features/backlog/handoff-branch-finder";
import type { HandoffPlace } from "@/features/backlog/handoff-request";

/**
 * Choosing where a hand off starts (#861), from "Hand off to a coding
 * tool" in docs/agents/ux-spec.md: the Start in menu's choices, the
 * hand-off sheet's Start in row, and Review prompt's two quiet buttons.
 * `domain/handoffs/start-in.ts` owns the wording and the default place.
 */

const PLACE_ICONS = {
  new: NewWorktreeIcon,
  worktree: PreviousWorktreeIcon,
  main: MainFolderIcon,
  ask: AskIcon,
} as const;

function StartPlaceIcon({
  icon,
  className = "size-4",
}: {
  icon: StartPlaceLines["icon"];
  className?: string;
}) {
  const Icon = PLACE_ICONS[icon];
  return <Icon aria-hidden="true" className={cn("shrink-0", className)} />;
}

/** One radio value per folder and place. A new worktree's source is not part of it. */
function choiceKey(folderId: string, place: StartPlace) {
  return JSON.stringify([
    folderId,
    place.kind,
    place.kind === "worktree" ? place.worktreeId : "",
  ]);
}

/**
 * The Start in menu's choices, as radio items: Main folder, New worktree,
 * and one row per worktree the item has, with its branch. With several
 * repository folders it lists them once per folder, under the folder's
 * name. New worktree is disabled, with why, in a folder Ajour can't make
 * one in. `closeOnClick` false keeps a menu around it open.
 */
export function StartInChoices({
  folders,
  value,
  onChange,
  closeOnClick = true,
}: {
  folders: readonly FolderStartOptions[];
  /** The place in force. Undefined when none is, as under Ask each time. */
  value: HandoffPlace | undefined;
  onChange: (place: HandoffPlace) => void;
  closeOnClick?: boolean;
}) {
  const places = new Map<string, HandoffPlace>();
  const keyOf = (folderId: string, startIn: HandoffStartIn) => {
    const key = choiceKey(folderId, startIn);
    places.set(key, { folderId, startIn });
    return key;
  };
  return (
    <DropdownMenuRadioGroup
      value={value ? choiceKey(value.folderId, value.startIn) : ""}
      onValueChange={(key: string) => {
        const next = places.get(key);
        if (next) onChange(next);
      }}
    >
      {folders.map((options) => {
        const { folder, worktrees } = options;
        const refusal = getNewWorktreeRefusal(options);
        return (
          <DropdownMenuGroup key={folder.id}>
            <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1 font-medium">
              {folders.length > 1 ? `Start in ${folder.name}` : "Start in"}
            </DropdownMenuLabel>
            <DropdownMenuRadioItem
              value={keyOf(folder.id, { kind: "main" })}
              closeOnClick={closeOnClick}
            >
              <StartPlaceIcon icon="main" />
              <ChoiceText title="Main folder" detail={folder.name} />
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value={keyOf(folder.id, { kind: "new" })}
              closeOnClick={closeOnClick}
              disabled={Boolean(refusal)}
              aria-description={refusal}
            >
              <StartPlaceIcon icon="new" />
              <ChoiceText title="New worktree" detail={refusal} />
            </DropdownMenuRadioItem>
            {worktrees.map((worktree) => (
              <DropdownMenuRadioItem
                key={worktree.id}
                value={keyOf(folder.id, {
                  kind: "worktree",
                  worktreeId: worktree.id,
                })}
                closeOnClick={closeOnClick}
              >
                <StartPlaceIcon icon="worktree" />
                <ChoiceText
                  title="Previous worktree"
                  detail={`${worktree.name} · ${worktree.branch}`}
                  mono
                />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuGroup>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

function ChoiceText({
  title,
  detail,
  mono,
}: {
  title: string;
  detail?: string;
  mono?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{title}</span>
      {detail ? (
        <span
          className={cn(
            "truncate text-xs text-muted-foreground",
            mono && "font-mono",
          )}
          title={detail}
        >
          {detail}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A new place from the menu. A new worktree keeps the source the user
 * already picked for it in the same folder.
 */
function mergePlace(
  current: HandoffPlace | undefined,
  next: HandoffPlace,
): HandoffPlace {
  return current?.folderId === next.folderId &&
    current.startIn.kind === "new" &&
    next.startIn.kind === "new"
    ? current
    : next;
}

/** A line of the row: one size and height in every state, cut with an ellipsis. */
const LINE =
  "-ml-1.5 block h-5 max-w-[calc(100%+0.375rem)] truncate rounded-sm px-1.5 py-0";
// The line height comes after the text size, which would otherwise reset it.
const TOP_LINE = `${LINE} text-sm leading-5 font-medium text-foreground`;
const BOTTOM_LINE = `${LINE} text-xs leading-5 font-normal text-muted-foreground`;
/**
 * A line that is a button: a faint background under the pointer, with the
 * keyboard's highlight, and while its menu is open. No border, no arrow,
 * and the text keeps its color.
 */
const LINE_BUTTON =
  "gap-0 focus:bg-foreground/10 data-open:bg-foreground/10 data-popup-open:bg-foreground/10";
const TOP_BUTTON = `${TOP_LINE} ${LINE_BUTTON} focus:text-foreground data-open:text-foreground data-popup-open:text-foreground`;
const BOTTOM_BUTTON = `${BOTTOM_LINE} ${LINE_BUTTON} focus:text-muted-foreground data-open:text-muted-foreground data-popup-open:text-muted-foreground`;

/** What happens after the folder is asked for, by the Start in setting. */
const AFTER_FOLDER = {
  worktree: "Then its last worktree there, or a new one",
  main: "Then its last worktree there, or the main folder",
  ask: "Then asks where to start",
} as const;

/**
 * The hand-off sheet's Start in row: an icon and two lines, under the
 * title. The top line says where the hand off starts and opens the Start in
 * menu. The bottom line says the source of a new worktree and opens the
 * branch finder. For the main folder and a previous worktree it shows the
 * branch as plain text. Both lines are items of the sheet's menu, so the
 * arrows reach them and Enter opens their menu. The row has one height in
 * every state, also while the local API answers.
 *
 * A project with no repository folder, or several, asks for the folder
 * first, so the row says that and what follows, as plain text.
 */
export function HandoffStartInRow({
  found,
  chosen,
  onChoose,
}: {
  /** The project's folders and start options, once the local API answered. */
  found: ProjectStartOptions | undefined;
  /** The place chosen in this opening of the sheet, if any. */
  chosen: HandoffStartIn | undefined;
  onChoose: (place: HandoffStartIn) => void;
}) {
  const [menu, setMenu] = useState<"place" | "source">();
  const toggle = (which: "place" | "source") => (open: boolean) =>
    setMenu((current) =>
      open ? which : current === which ? undefined : current,
    );
  const placeLine = useRef<HTMLDivElement>(null);
  const sourceLine = useRef<HTMLDivElement>(null);
  /**
   * Closes a line's menu after a choice and gives the line the focus back,
   * so the keyboard goes on from where it was. The sheet would otherwise
   * move the focus to its first tool once the menu is gone.
   */
  const closeOn = (line: { current: HTMLElement | null }) => {
    setMenu(undefined);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => line.current?.focus({ preventScroll: true })),
    );
  };
  const settings = found?.options?.startIn;
  const options =
    found?.folders.length === 1 ? found.options?.folders[0] : undefined;

  let icon: StartPlaceLines["icon"] = "new";
  let top = <span className={TOP_LINE}>{" "}</span>;
  let bottom = <span className={BOTTOM_LINE}>{" "}</span>;

  if (found && found.folders.length !== 1) {
    icon = settings === "main" ? "main" : settings === "ask" ? "ask" : "new";
    top = (
      <span className={TOP_LINE}>{getHandoffFolderNote(found.folders)}</span>
    );
    if (settings)
      bottom = (
        <span className={BOTTOM_LINE} title={AFTER_FOLDER[settings]}>
          {AFTER_FOLDER[settings]}
        </span>
      );
  } else if (options && settings) {
    const folderId = options.folder.id;
    const place: StartPlace = chosen ?? defaultStartPlace(settings, options);
    const lines = describeStartPlace(place, options);
    const source = getStartSource(place, options);
    icon = lines.icon;
    top = (
      <DropdownMenuSub open={menu === "place"} onOpenChange={toggle("place")}>
        <DropdownMenuSubTrigger
          ref={placeLine}
          chevron={false}
          openOnHover={false}
          aria-label={`Start in: ${lines.title}`}
          // The bottom line is plain text for these places: say it here too.
          aria-description={lines.sourced ? undefined : lines.detail}
          className={TOP_BUTTON}
        >
          {lines.title}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          side="bottom"
          align="start"
          alignOffset={0}
          sideOffset={4}
          className="w-64"
        >
          <StartInChoices
            folders={[options]}
            value={
              place.kind === "ask" ? undefined : { folderId, startIn: place }
            }
            // Only this menu closes: the sheet stays, for the tool's pick.
            closeOnClick={false}
            onChange={(next) => {
              onChoose(
                mergePlace(
                  place.kind === "ask"
                    ? undefined
                    : { folderId, startIn: place },
                  next,
                ).startIn,
              );
              closeOn(placeLine);
            }}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
    bottom =
      lines.sourced && place.kind === "new" ? (
        <DropdownMenuSub
          open={menu === "source"}
          onOpenChange={toggle("source")}
        >
          <DropdownMenuSubTrigger
            ref={sourceLine}
            chevron={false}
            openOnHover={false}
            aria-label={`Source: ${lines.detail}`}
            title={lines.branch}
            className={BOTTOM_BUTTON}
          >
            {lines.detail}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            side="bottom"
            align="start"
            alignOffset={0}
            sideOffset={4}
            className="w-64"
          >
            <BranchFinder
              autoFocus
              label="Source branch"
              placeholder="Find a branch…"
              folderName={options.folder.name}
              branches={options.branches?.branches ?? []}
              checked={source ? { kind: "branch", name: source } : undefined}
              note={
                options.branches?.truncated
                  ? "This repository has more branches than Ajour lists."
                  : undefined
              }
              onChoose={(choice) => {
                if (choice.kind === "branch")
                  onChoose({ ...place, source: choice.name });
                closeOn(sourceLine);
              }}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <span className={BOTTOM_LINE} title={lines.branch}>
          {lines.detail || " "}
        </span>
      );
  }

  return (
    <div className="flex h-11 items-center gap-2 px-3 pb-1.5">
      <span className="grid w-7 shrink-0 place-items-center text-muted-foreground">
        <StartPlaceIcon icon={icon} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        {top}
        {bottom}
      </div>
    </div>
  );
}

/** A quiet text button: 12px, muted, no frame until hovered. */
const QUIET_BUTTON =
  "h-6 min-w-0 gap-1.5 px-1.5 text-xs font-normal text-muted-foreground aria-expanded:bg-muted aria-expanded:text-foreground";

/**
 * Review prompt's two quiet buttons, right under the prompt. The left one
 * says where the hand off starts and opens the Start in menu, which lists
 * its choices once per repository folder when the project has several; the
 * button then names the folder. The right one says the source of a new
 * worktree, "From origin/main", and opens the branch finder, where a typed
 * name sets the new branch: it then reads "<name> from <source>". For the
 * main folder and a previous worktree the right side is the branch as plain
 * text. Each tooltip gives the worktree's path or the whole branch name.
 * For a tool that makes its own worktree (`ownWorktreeOf`, #863) both
 * tooltips say so outside the main folder, since no path of Ajour's is its.
 */
export function HandoffPlaceButtons({
  folders,
  folder,
  place,
  template,
  ownWorktreeOf,
  disabled,
  onPlace,
  onChooseFolder,
}: {
  /** Every folder's start options. Undefined until the local API answered. */
  folders: readonly FolderStartOptions[] | undefined;
  /** The folder the hand off starts in. Undefined while none is chosen. */
  folder: RepositoryFolder | undefined;
  /** The place in force in that folder. */
  place: HandoffStartIn | undefined;
  /** The branch template's name for this item, for the tooltip. */
  template: { branch: string };
  /** The tool's label, when it makes its own worktree. */
  ownWorktreeOf?: string;
  disabled?: boolean;
  onPlace: (place: HandoffPlace) => void;
  /** Opens the repository picker, for a project without a folder. */
  onChooseFolder: () => void;
}) {
  const [finding, setFinding] = useState(false);
  const options = folders?.find(
    (candidate) => candidate.folder.id === folder?.id,
  );
  if (!folder || !options || !place)
    return (
      <div className="-mx-1.5 flex h-6 min-w-0 items-center justify-between gap-2">
        {folders && !folders.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={QUIET_BUTTON}
            disabled={disabled}
            onClick={onChooseFolder}
          >
            <StartPlaceIcon icon="main" className="size-3.5" />
            Add a repository folder…
          </Button>
        ) : null}
      </div>
    );

  const current: HandoffPlace = { folderId: folder.id, startIn: place };
  const lines = describeStartPlace(place, options);
  const several = (folders?.length ?? 0) > 1;
  const where = several ? `${lines.title} in ${folder.name}` : lines.title;
  const wherePath =
    place.kind === "main"
      ? folder.path
      : ((ownWorktreeOf
          ? getOwnWorktreeNote(place, options, ownWorktreeOf)
          : undefined) ??
        (place.kind === "worktree"
          ? getWorktreePath(
              folder.path,
              options.worktrees.find((w) => w.id === place.worktreeId)?.name,
            )
          : `A new worktree in ${getWorktreePath(folder.path)}`));
  const source = getStartSource(place, options);
  const summary = summarizeStartPlace(place, options, template, ownWorktreeOf);

  return (
    <div className="-mx-1.5 flex h-6 min-w-0 items-center justify-between gap-2">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                disabled={disabled}
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={QUIET_BUTTON}
                  />
                }
              />
            }
          >
            <StartPlaceIcon icon={lines.icon} className="size-3.5" />
            <span className="truncate">{where}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{wherePath}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-64">
          <StartInChoices
            folders={folders ?? []}
            value={current}
            onChange={(next) => onPlace(mergePlace(current, next))}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {place.kind === "new" && lines.sourced ? (
        <Popover open={finding} onOpenChange={setFinding}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  disabled={disabled}
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={QUIET_BUTTON}
                    />
                  }
                />
              }
            >
              <BranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                {place.branch ? (
                  <>
                    <span className="text-foreground">{place.branch}</span> from{" "}
                    {source ?? "the default branch"}
                  </>
                ) : (
                  lines.detail
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{summary}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-72 gap-0 p-1.5">
            <BranchFinder
              autoFocus
              label="Source branch, or a name for the new branch"
              placeholder="Find or name a branch…"
              folderName={folder.name}
              branches={options.branches?.branches ?? []}
              naming={{ verb: "Name the new branch" }}
              checked={source ? { kind: "branch", name: source } : undefined}
              note={
                options.branches?.truncated
                  ? "This repository has more branches than Ajour lists."
                  : undefined
              }
              onChoose={(choice) => {
                if (choice.kind === "branch")
                  onPlace({
                    folderId: folder.id,
                    startIn: { ...place, source: choice.name },
                  });
                else if (choice.kind === "name")
                  onPlace({
                    folderId: folder.id,
                    startIn: { ...place, branch: choice.name },
                  });
                setFinding(false);
              }}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground"
              />
            }
          >
            <BranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{lines.detail}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{summary}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
