import * as React from "react";
import { RiMoreLine as More } from "@remixicon/react";
import {
  getObjectActionSections,
  type ObjectAction,
} from "@/domain/actions/object-actions";
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
  hasNativeContextMenu,
  leavesContextMenuToSystem,
  showNativeContextMenu,
  trackMenuPresses,
} from "@/lib/native-context-menu";
import {
  CLIPBOARD_KEYS,
  formatAriaKeyChord,
  formatAriaKeyShortcuts,
  formatKeyChord,
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

/**
 * The key a menu item shows for `action` and its `aria-keyshortcuts` value:
 * the system's key for Cut, Copy and Paste, else the action's shortcut.
 */
function getActionKeyLabel<Id extends string>(
  action: ObjectAction<Id>,
  keys: ActionKeys<Id> | undefined,
) {
  if (action.clipboard) {
    const chord = CLIPBOARD_KEYS[action.clipboard];
    return {
      label: formatKeyChord(chord, platform),
      aria: formatAriaKeyChord(chord, platform),
    };
  }

  const shortcutId = keys?.[action.id];
  if (!shortcutId) {
    return undefined;
  }

  const shortcut = getShortcut(shortcutId);
  return {
    label: formatShortcutKeys(shortcut, platform).join(" "),
    aria: formatAriaKeyShortcuts(shortcut, platform),
  };
}

/**
 * Renders one action set as menu items, with a line between its sections (see
 * `getObjectActionSections`). Shared by the "…" menu and the browser's
 * right-click menu; the desktop app draws right-click menus natively. A
 * disabled action is greyed out; only screen readers hear its reason.
 */
export function ObjectActionItems<Id extends string>({
  actions,
  onAction,
  keys,
}: ObjectActionsProps<Id>) {
  return getObjectActionSections(actions).map((section, index) => (
    <React.Fragment key={section[0]!.id}>
      {index > 0 ? <DropdownMenuSeparator /> : null}
      {section.map((action) => {
        const detail = action.disabledReason ? undefined : action.hint;
        const keyLabel = getActionKeyLabel(action, keys);
        return (
          <DropdownMenuItem
            key={action.id}
            variant={action.destructive ? "destructive" : "default"}
            disabled={Boolean(action.disabledReason)}
            aria-description={action.disabledReason}
            aria-keyshortcuts={keyLabel?.aria}
            onClick={(event) => {
              event.stopPropagation();
              onAction(action.id);
            }}
            className="flex-col items-stretch gap-0"
          >
            <span className="flex items-center gap-6">
              <span>{action.label}</span>
              {keyLabel ? (
                // aria-keyshortcuts tells screen readers; the label stays the name.
                <DropdownMenuShortcut aria-hidden="true">
                  {keyLabel.label}
                </DropdownMenuShortcut>
              ) : null}
            </span>
            {detail ? (
              <span className="text-xs font-normal text-muted-foreground">
                {detail}
              </span>
            ) : null}
          </DropdownMenuItem>
        );
      })}
    </React.Fragment>
  ));
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
        size="icon"
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
                size="icon"
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

type ObjectContextMenuProps<Id extends string> = ObjectActionsProps<Id> & {
  render: React.ReactElement;
  children?: React.ReactNode;
};

const nativeContextMenu = hasNativeContextMenu();

/**
 * Opens an object's action set on right-click. `render` is the element that receives
 * the right-click, such as a table row or a card. The desktop app shows the system's
 * own menu; the browser shows the Base UI menu, which merges its props into `render`.
 */
export function ObjectContextMenu<Id extends string>(
  props: ObjectContextMenuProps<Id>,
) {
  if (nativeContextMenu) {
    return <NativeObjectContextMenu {...props} />;
  }

  const { actions, onAction, keys, render, children } = props;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ObjectActionItems actions={actions} onAction={onAction} keys={keys} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The desktop right-click menu. A right-click in a text field or on selected
 * text inside `render` is left to the system's edit menu (Cut, Copy, Paste), and
 * `render`'s own handler does not run. The menu pops up after the render that
 * the right-click causes, so it lists the actions of the selection that
 * `render`'s own handler has just made.
 */
function NativeObjectContextMenu<Id extends string>({
  actions,
  onAction,
  keys,
  render,
  children,
}: ObjectContextMenuProps<Id>) {
  const [request, setRequest] = React.useState<{ x: number; y: number }>();
  const latest = React.useRef({ actions, onAction, keys });
  React.useLayoutEffect(() => {
    latest.current = { actions, onAction, keys };
  });

  React.useEffect(() => {
    trackMenuPresses();
  }, []);

  React.useEffect(() => {
    if (!request) return;
    const { actions: shown, keys: shownKeys } = latest.current;
    void showNativeContextMenu(shown, shownKeys, request).then((id) => {
      if (id !== null) latest.current.onAction(id);
    });
  }, [request]);

  const element = render as React.ReactElement<
    React.HTMLAttributes<HTMLElement>
  >;
  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (leavesContextMenuToSystem(event.nativeEvent)) return;
    element.props.onContextMenu?.(event);
    event.preventDefault();
    event.stopPropagation();
    setRequest({ x: event.clientX, y: event.clientY });
  };

  return children === undefined
    ? React.cloneElement(element, { onContextMenu: handleContextMenu })
    : React.cloneElement(
        element,
        { onContextMenu: handleContextMenu },
        children,
      );
}
