import * as React from "react";
import { RiMoreLine as More } from "@remixicon/react";
import type { ObjectAction } from "@/domain/actions/object-actions";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCUS_ITEM_SELECTOR, type ActionKeys } from "@/lib/item-keys";
import {
  formatAriaKeyShortcuts,
  formatShortcutKeys,
  getShortcut,
  getShortcutPlatform,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface ObjectActionsProps<Id extends string> {
  actions: ObjectAction<Id>[];
  onAction: (id: Id) => void;
  /**
   * The shortcut of each action, shown next to its label so the menu teaches
   * the keys. Pass it only where those keys work, such as on focusable rows.
   */
  keys?: ActionKeys<Id>;
}

const platform = getShortcutPlatform();

/** Renders one action set as menu items. Shared by the "…" menu and the right-click menu. */
function ObjectActionItems<Id extends string>({
  actions,
  onAction,
  keys,
}: ObjectActionsProps<Id>) {
  return actions.map((action, index) => {
    const startsDestructiveGroup =
      action.destructive && index > 0 && !actions[index - 1]?.destructive;
    const detail = action.disabledReason ?? action.hint;
    const shortcut = keys?.[action.id]
      ? getShortcut(keys[action.id]!)
      : undefined;
    return (
      <React.Fragment key={action.id}>
        {startsDestructiveGroup ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          variant={action.destructive ? "destructive" : "default"}
          disabled={Boolean(action.disabledReason)}
          aria-keyshortcuts={
            shortcut ? formatAriaKeyShortcuts(shortcut, platform) : undefined
          }
          onClick={(event) => {
            event.stopPropagation();
            onAction(action.id);
          }}
          className="flex-col items-stretch gap-0"
        >
          <span className="flex items-center gap-6">
            <span>{action.label}</span>
            {shortcut ? (
              // aria-keyshortcuts tells screen readers; the label stays the name.
              <DropdownMenuShortcut aria-hidden="true">
                {formatShortcutKeys(shortcut, platform).join(" ")}
              </DropdownMenuShortcut>
            ) : null}
          </span>
          {detail ? (
            <span className="text-xs font-normal text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </DropdownMenuItem>
      </React.Fragment>
    );
  });
}

/**
 * The "…" button that opens an object's action set. Rows show it on hover and focus;
 * the narrow view always shows it (see `.object-actions-button` in styles.css).
 * Inside a focusable row or card, closing the menu gives focus back to the row,
 * so its keys keep working.
 */
export function ObjectActionsButton<Id extends string>({
  actions,
  onAction,
  keys,
  label,
  className,
  live = true,
}: ObjectActionsProps<Id> & {
  label: string;
  className?: string;
  /**
   * False renders the button alone, with the same footprint and label but no
   * menu or tooltip. A long list passes it until the row is hovered or
   * focused, which always comes before a click or a key on the button.
   */
  live?: boolean;
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  if (!live) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("object-actions-button", className)}
        aria-label={label}
        aria-haspopup="menu"
        tabIndex={-1}
        data-no-entry-drag="true"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <More />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <TooltipButton
        label={label}
        // The "." key opens the menu only where the row's keys work.
        shortcut={keys ? "item.open-menu" : undefined}
        render={
          <DropdownMenuTrigger
            render={
              <Button
                ref={triggerRef}
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn("object-actions-button", className)}
                data-no-entry-drag="true"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              />
            }
          />
        }
      >
        <More />
      </TooltipButton>
      <DropdownMenuContent
        align="end"
        className="w-auto min-w-52"
        finalFocus={() =>
          triggerRef.current?.closest<HTMLElement>(FOCUS_ITEM_SELECTOR) ?? true
        }
      >
        <ObjectActionItems actions={actions} onAction={onAction} keys={keys} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Opens an object's action set on right-click. `render` is the element that receives
 * the right-click, such as a table row or a card; its props are merged by Base UI.
 */
export function ObjectContextMenu<Id extends string>({
  actions,
  onAction,
  keys,
  render,
  children,
}: ObjectActionsProps<Id> & {
  render: React.ReactElement;
  children?: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ObjectActionItems actions={actions} onAction={onAction} keys={keys} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
