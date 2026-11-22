import { useEffect, useState } from "react";
import { RiArrowDownSLine as MenuIcon } from "@remixicon/react";

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
import type { LocalWorkItem } from "@/domain/local-state";
import { listRepositoryFolders } from "@/lib/app-api";
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
 * Where the thread starts, for the sheet's heading (`getHandoffFolderNote`).
 * Asked each time the sheet opens, and empty until the project's folders
 * answer; a failed lookup says nothing.
 */
function useHandoffFolderNote(projectId: string | undefined, open: boolean) {
  const [found, setFound] = useState<{ projectId: string; note: string }>();
  useEffect(() => {
    if (!open || !projectId) return;
    let live = true;
    void listRepositoryFolders(projectId)
      .then((folders) => {
        if (live) setFound({ projectId, note: getHandoffFolderNote(folders) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, projectId]);
  return found && found.projectId === projectId ? found.note : "";
}

/**
 * The item page's Hand off button, with the logos of the first tools. It
 * opens the hand-off sheet, a menu headed by where the thread starts, with
 * one row per tool that is on: its logo, its name and whether it follows
 * progress, those this computer lacks disabled with why. The tool last used
 * on this device comes first and takes the focus. Then Review prompt…, for
 * that first tool, and Choose tools…, which leads to the switches. While
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
  const folderNote = useHandoffFolderNote(item.projectId, open);
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
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
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
      <DropdownMenuContent className="w-76">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex min-h-12 flex-col px-3 pt-2 pb-1.5">
            <span className="text-sm font-medium text-foreground">
              Hand off
            </span>
            <span className="truncate">{folderNote}</span>
          </DropdownMenuLabel>
          {ordered.map((tool, index) => {
            const refusal = getHandoffToolRefusal(tool);
            const summary = [
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
                  requestHandoff({ itemId: item._id, toolKey: tool.key })
                }
              >
                <HandoffToolIcon tool={tool} className="size-7 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{tool.label}</span>
                  <span className="text-xs text-muted-foreground">
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
            })
          }
        >
          <span>Review prompt…</span>
          <span className="text-xs text-muted-foreground">
            {reviewRefusal ??
              `Edit the prompt, folder and branch for ${first.label}`}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={requestChooseHandoffTools}>
          Choose tools…
        </DropdownMenuItem>
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
