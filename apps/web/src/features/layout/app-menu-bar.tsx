import { useCallback, useEffect, useRef, type FocusEvent } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import {
  formatMenuAccelerator,
  resolveAppMenuAction,
} from "@/features/layout/app-menu";
import type { DesktopAppMenu, DesktopAppMenuItem } from "@/lib/desktop-bridge";
import { isDesktopShell } from "@/lib/runtime";
import { useRunShortcut } from "@/lib/shortcut-handlers";
import { requestUpdateCheck } from "@/lib/update-check-request";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import {
  toggleSidebarDensity,
  toggleSidebarUpNext,
} from "@/lib/sidebar-layout";

const isWindowsDesktopShell =
  isDesktopShell &&
  typeof window !== "undefined" &&
  window.ajourDesktop?.runtime?.platform === "win32";

function useAppMenuActionRunner() {
  const navigate = useNavigate();
  const router = useRouter();
  const runShortcut = useRunShortcut();

  return useCallback(
    (action: unknown) => {
      const command = resolveAppMenuAction(action);
      if (command?.kind === "shortcut") {
        runShortcut(command.id);
      } else if (command?.kind === "toggle-sidebar-density") {
        toggleSidebarDensity();
      } else if (command?.kind === "toggle-sidebar-up-next") {
        toggleSidebarUpNext();
      } else if (command?.kind === "check-for-updates") {
        // Opening General checks for updates. When it is already open, ask it.
        if (router.state.location.pathname === "/settings/general") {
          requestUpdateCheck();
        } else {
          void navigate({ to: "/settings/general" });
        }
      }
    },
    [navigate, router, runShortcut],
  );
}

/**
 * The desktop app menu in the renderer. On every desktop platform it runs the
 * actions the native menu sends. On Windows at desktop widths it also draws the
 * menus in the title bar, because the hidden title bar hides the native menu.
 * The narrow view and the web build show no menu bar.
 */
export function AppMenuBar() {
  const runAction = useAppMenuActionRunner();
  const isNarrowView = useIsNarrowView();
  const menus = window.ajourDesktop?.appMenu;

  useEffect(() => window.ajourDesktop?.onMenuAction?.(runAction), [runAction]);

  if (!isWindowsDesktopShell || isNarrowView || !menus) {
    return null;
  }

  return <WindowsMenuBar menus={menus} runAction={runAction} />;
}

function WindowsMenuBar({
  menus,
  runAction,
}: {
  menus: DesktopAppMenu[];
  runAction: (action: string) => void;
}) {
  // The element that had focus before the menu bar took it. Copy and Paste act
  // on it, and Continue reads the focused entry row from it.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pendingItemRef = useRef<DesktopAppMenuItem | null>(null);

  function rememberReturnFocus(event: FocusEvent<HTMLDivElement>) {
    const from = event.relatedTarget;
    // Focus moving between triggers and open menus keeps the first element.
    if (
      from instanceof HTMLElement &&
      (event.currentTarget.contains(from) || from.closest('[role="menu"]'))
    ) {
      return;
    }
    returnFocusRef.current = from instanceof HTMLElement ? from : null;
  }

  function returnFocusTarget() {
    const target = returnFocusRef.current;
    return target?.isConnected ? target : true;
  }

  // Runs the chosen item once its menu has closed and focus is back where the
  // user was, so roles such as Copy see the right selection.
  function runPendingItem(open: boolean) {
    const item = pendingItemRef.current;
    if (open || !item) {
      return;
    }
    pendingItemRef.current = null;

    const target = returnFocusTarget();
    if (target !== true) {
      target.focus();
    }
    if (item.type === "action") {
      runAction(item.action);
    } else if (item.type === "role") {
      window.ajourDesktop?.runMenuItem?.(item.id);
    }
  }

  return (
    <Menubar
      aria-label="Application menu"
      className="desktop-no-drag h-7 gap-0.5 rounded-none border-0 bg-transparent p-0"
      onFocusCapture={rememberReturnFocus}
    >
      {menus.map((menu) => (
        <MenubarMenu key={menu.id} onOpenChangeComplete={runPendingItem}>
          <MenubarTrigger className="h-7 rounded-md px-2 py-0 text-[13px] font-normal">
            {menu.label}
          </MenubarTrigger>
          <MenubarContent finalFocus={returnFocusTarget}>
            {menu.items.map((item, index) =>
              item.type === "separator" ? (
                <MenubarSeparator key={`separator-${index}`} />
              ) : (
                <MenubarItem
                  key={item.id}
                  onClick={() => {
                    pendingItemRef.current = item;
                  }}
                >
                  {item.label}
                  {item.accelerator ? (
                    <MenubarShortcut>
                      {formatMenuAccelerator(item.accelerator)}
                    </MenubarShortcut>
                  ) : null}
                </MenubarItem>
              ),
            )}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
}
