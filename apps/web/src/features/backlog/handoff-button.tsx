import { useState } from "react";
import { RiArrowDownSLine as MenuIcon } from "@remixicon/react";
import type { HandoffStartIn } from "@ajour/shared/worktrees";

import { DisabledReason } from "@/components/disabled-reason";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getHandoffFolderNote,
  getHandoffItemRefusal,
  getHandoffToolRefusal,
  getHandoffToolSummary,
  orderHandoffTools,
  type HandoffTool,
} from "@/domain/handoffs/handoffs";
import {
  defaultStartPlace,
  getOwnWorktreeNote,
} from "@/domain/handoffs/start-in";
import type { LocalWorkItem } from "@/domain/local-state";
import { useProjectStartOptions } from "@/lib/handoff-start-options";
import {
  detectHandoffToolsFor,
  useHandoffTools,
  useHandoffToolsChoice,
  useLastHandoffTool,
} from "@/lib/handoff-tools";
import {
  requestChooseHandoffTools,
  requestHandoff,
  useHandoffStarting,
} from "@/features/backlog/handoff-request";
import { HandoffStartInRow } from "@/features/backlog/handoff-start-in";

/** A tool's own icon, from its plugin's manifest, drawn as an image. */
export function HandoffToolIcon({
  tool,
  className = "size-4",
}: {
  tool: Pick<HandoffTool, "iconSvg">;
  className?: string;
}) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      src={`data:image/svg+xml,${encodeURIComponent(tool.iconSvg)}`}
    />
  );
}

/** The sheet opens on its first tool, so Enter hands off to it. */
function focusWhenShown(row: HTMLElement | null) {
  if (!row) return;
  const frame = requestAnimationFrame(() => row.focus({ preventScroll: true }));
  return () => cancelAnimationFrame(frame);
}

/**
 * The item page's Hand off button, with the logos of the first tools. It
 * opens the hand-off sheet, a menu headed by the Start in row, which says
 * where the hand off starts and lets the user change it for this opening of
 * the sheet (#861). Then one row per tool that is on: its logo, its name
 * and whether it follows progress, those this computer lacks disabled with
 * why. A tool that makes its own worktree says so instead where the hand
 * off would start in a worktree, and that it can't join one the item has
 * (#863). The tool last used on this device comes first and takes the focus,
 * so Enter hands off. Then Review prompt…, for that first tool, and Choose
 * tools…, which leads to the switches. While
 * handoff plugins are active and none of their tools is on, the button reads
 * Choose your tools and leads there itself. Without a handoff plugin, as in
 * the web build, it renders nothing.
 */
export function HandoffButton({ item }: { item: LocalWorkItem }) {
  const tools = useHandoffTools(item.projectId);
  const choice = useHandoffToolsChoice();
  const lastKey = useLastHandoffTool();
  const busy = useHandoffStarting(item._id);
  const [open, setOpen] = useState(false);
  /** The place chosen in the Start in row, for this opening only. */
  const [chosen, setChosen] = useState<HandoffStartIn>();
  const found = useProjectStartOptions(item.projectId, item._id, open);
  if (!tools.length)
    return choice ? (
      <Button variant="outline" onClick={requestChooseHandoffTools}>
        Choose your tools
      </Button>
    ) : null;
  const ordered = orderHandoffTools(tools, lastKey);
  const first = ordered[0]!;
  const itemRefusal = getHandoffItemRefusal(item);
  const reviewRefusal = getHandoffToolRefusal(first);
  // The chosen place goes with the request. It names the project's one
  // folder: the row offers no choice otherwise.
  const folderId =
    found?.folders.length === 1 ? found.folders[0]!.id : undefined;
  const place =
    chosen && folderId ? { place: { folderId, startIn: chosen } } : {};
  // Where a click on a tool starts, as the Start in row says it, once the
  // project's one folder is read. A tool that makes its own worktree says
  // on its row what it does there.
  const options =
    found?.folders.length === 1 ? found.options?.folders[0] : undefined;
  const ownWorktreeNote =
    options && found?.options
      ? getOwnWorktreeNote(
          chosen ?? defaultStartPlace(found.options.startIn, options),
          options,
        )
      : undefined;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Each opening starts from the default place again.
        if (next) setChosen(undefined);
        // A tool installed since the page opened shows up in the sheet.
        if (next && item.projectId) void detectHandoffToolsFor(item.projectId);
      }}
    >
      {/* Only a lasting refusal gets the tooltip: wrapping the button while a
          hand off starts would remount it and drop its focus. */}
      <DisabledReason label="Hand off" reason={itemRefusal}>
        <DropdownMenuTrigger
          disabled={Boolean(itemRefusal) || busy}
          render={<Button variant="outline" />}
        >
          <span className="handoff-logos" aria-hidden="true">
            {ordered.slice(0, MAX_BUTTON_LOGOS).map((tool) => (
              <HandoffToolIcon key={tool.key} tool={tool} />
            ))}
          </span>
          Hand off
          <MenuIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
      </DisabledReason>
      {/* The tools come first in the menu's own order and the Start in row
          last, drawn above them by `order-first`. So the sheet opens on its
          first tool however it was opened, and Enter hands off. The arrows
          still follow what the eye sees: the menu wraps, so Up from the
          first tool reaches the row's bottom line, then its top line. */}
      <DropdownMenuContent className="flex w-76 flex-col">
        <DropdownMenuGroup aria-label="Tools">
          {ordered.map((tool, index) => {
            const refusal = getHandoffToolRefusal(tool);
            // What a tool that makes its own worktree does here takes the
            // line alone, cut with an ellipsis: with "last used" after it,
            // or a long worktree name in it, the row would grow a line.
            const ownNote =
              !refusal && tool.ownWorktree ? ownWorktreeNote : undefined;
            const summary =
              ownNote ??
              [
                getHandoffToolSummary(tool),
                ...(tool.key === lastKey && !refusal ? ["last used"] : []),
              ].join(" · ");
            return (
              <DropdownMenuItem
                key={tool.key}
                ref={index === 0 && !refusal ? focusWhenShown : undefined}
                disabled={Boolean(refusal)}
                aria-label={`Hand off to ${tool.label}`}
                aria-description={summary}
                onClick={() =>
                  requestHandoff({
                    itemId: item._id,
                    toolKey: tool.key,
                    ...place,
                  })
                }
              >
                <HandoffToolIcon tool={tool} className="size-7 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{tool.label}</span>
                  <span
                    className={
                      ownNote
                        ? "truncate text-xs text-muted-foreground"
                        : "text-xs text-muted-foreground"
                    }
                    title={ownNote}
                  >
                    {summary}
                  </span>
                </span>
                {index === 0 && !refusal ? (
                  <DropdownMenuShortcut aria-hidden="true">
                    ↵
                  </DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={Boolean(reviewRefusal)}
          aria-description={reviewRefusal}
          className="flex-col items-stretch gap-0"
          onClick={() =>
            requestHandoff({
              itemId: item._id,
              toolKey: first.key,
              review: true,
              ...place,
            })
          }
        >
          <span>Review prompt…</span>
          <span className="text-xs text-muted-foreground">
            {reviewRefusal ?? `Edit the prompt and where ${first.label} starts`}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={requestChooseHandoffTools}>
          Choose tools…
        </DropdownMenuItem>
        <DropdownMenuGroup className="order-first">
          <DropdownMenuLabel className="px-3 pt-2 pb-0.5 text-sm font-medium text-foreground">
            Hand off
            {/* The row is plain text when the folder is asked for first, so
                the group's name carries it for a screen reader. */}
            {found && found.folders.length !== 1 ? (
              <span className="sr-only">
                . {getHandoffFolderNote(found.folders)}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <HandoffStartInRow
            found={found}
            chosen={chosen}
            onChoose={setChosen}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="order-first" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * More logos than this would crowd the button's label. The style stacks
 * this many (`.handoff-logos` in styles/backlog.css).
 */
const MAX_BUTTON_LOGOS = 3;

/**
 * The Handoffs card's buttons: one per tool that is on, with its logo and
 * name, in their plugins' order so a button never moves. Each hands the item
 * off through the same flow as the sheet, and says why it can't in a tooltip.
 * All wait while a hand off of the item starts.
 */
export function HandoffStartButtons({ item }: { item: LocalWorkItem }) {
  const tools = useHandoffTools(item.projectId);
  const busy = useHandoffStarting(item._id);
  const itemRefusal = getHandoffItemRefusal(item);
  return (
    <div className="handoff-starters">
      {tools.map((tool) => {
        const label = `Hand off to ${tool.label}`;
        const reason = itemRefusal ?? getHandoffToolRefusal(tool);
        return (
          <DisabledReason key={tool.key} label={label} reason={reason}>
            <Button
              variant="outline"
              size="sm"
              aria-label={label}
              disabled={Boolean(reason) || busy}
              onClick={() =>
                requestHandoff({ itemId: item._id, toolKey: tool.key })
              }
            >
              <HandoffToolIcon tool={tool} />
              {tool.label}
            </Button>
          </DisabledReason>
        );
      })}
    </div>
  );
}
