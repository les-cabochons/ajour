import * as React from "react";
import { RiMoreLine as More } from "@remixicon/react";
import type { ObjectAction } from "@/domain/actions/object-actions";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ObjectActionsProps<Id extends string> {
  actions: ObjectAction<Id>[];
  onAction: (id: Id) => void;
}

/** Renders one action set as menu items. Shared by the "…" menu and the right-click menu. */
function ObjectActionItems<Id extends string>({
  actions,
  onAction,
}: ObjectActionsProps<Id>) {
  return actions.map((action, index) => {
    const startsDestructiveGroup =
      action.destructive && index > 0 && !actions[index - 1]?.destructive;
    const detail = action.disabledReason ?? action.hint;
    return (
      <React.Fragment key={action.id}>
        {startsDestructiveGroup ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          variant={action.destructive ? "destructive" : "default"}
          disabled={Boolean(action.disabledReason)}
          onClick={(event) => {
            event.stopPropagation();
            onAction(action.id);
          }}
          className="flex-col items-start gap-0"
        >
          <span>{action.label}</span>
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
 */
export function ObjectActionsButton<Id extends string>({
  actions,
  onAction,
  label,
  className,
}: ObjectActionsProps<Id> & { label: string; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={cn("object-actions-button", className)}
            data-no-entry-drag="true"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          />
        }
      >
        <More />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52">
        <ObjectActionItems actions={actions} onAction={onAction} />
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
        <ObjectActionItems actions={actions} onAction={onAction} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
