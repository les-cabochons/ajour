import { Fragment, useCallback, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import {
  buildPaletteSections,
  type PaletteCommand,
  type PaletteItem,
  type PaletteView,
  type SortableObjectRef,
} from "@/features/command-palette/command-palette-items";
import { ProjectFormDialog } from "@/features/projects/project-form-dialog";
import { getSettingsPages } from "@/features/settings/settings-navigation";
import { openNewEntryEditor } from "@/features/time/new-entry-request";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import type { ActionRequest } from "@/lib/action-request";
import {
  resolveFocusedObject,
  type FocusedObjectRef,
} from "@/lib/focused-object";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useShortcut, useShortcutRunner } from "@/lib/shortcut-handlers";
import { SHORTCUTS, getShortcutPlatform } from "@/lib/shortcuts";
import { getSharedTableStepOrder } from "@/lib/table-drag";
import { selectSortableDayEntryIds } from "@/domain/time/timesheet-entry";
import { useCalendarSources } from "@/lib/calendar-suggestions";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { cn } from "@/lib/utils";

const platform = getShortcutPlatform();
const ROOT_VIEW: PaletteView = { kind: "root" };

/**
 * The app-wide command palette (Cmd+K, Ctrl+K elsewhere). It lists the focused
 * object's actions, search results across tasks, backlog items and projects,
 * the registry's global actions with their keys, and navigation. Choosing a
 * task or a backlog item lists its actions.
 *
 * Start entry and New entry… run here, so they work from any page. New entry…
 * opens the titlebar's entry editor popover, anchored to the object's row when
 * that row is still on screen, otherwise to the titlebar's totals. Actions that
 * need a page's editor, confirmation or navigation guard go to that page as an
 * action request (`lib/action-request.ts`). While the Projects page is open,
 * every project and task command goes to it, so its task draft is saved first
 * or blocks the command, as with the page's own controls. Commands run once the
 * palette has closed and given focus back, so shortcuts that read focus, such
 * as Continue, see the row.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const router = useRouter();
  const state = useLocalState();
  const isNarrowView = useIsNarrowView();
  const hasCalendar = useCalendarSources().length > 0;
  const shortcutRunner = useShortcutRunner();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<PaletteView>(ROOT_VIEW);
  const [focused, setFocused] = useState<FocusedObjectRef | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const originRef = useRef<HTMLElement | null>(null);
  const pendingCommandRef = useRef<PaletteCommand | null>(null);

  const timer = state.timers[0] ?? null;

  function editEntry(localDate: string, search: Record<string, unknown>) {
    void navigate({
      to: "/time/$date",
      params: { date: localDate },
      // Keep the Week view when the entry is edited from it.
      search: ((previous: Record<string, unknown>) => ({
        view: previous.view,
        ...search,
      })) as never,
    });
  }

  const entryActions = useTimeEntryActions({
    onEdit: (target) => {
      if (target.kind === "entry") {
        editEntry(target.entry.localDate, { entry: target.entry._id });
        return;
      }

      const runningTimer = localStore
        .snapshot()
        .timers.find((item) => item._id === target.timerId);
      if (runningTimer) {
        editEntry(runningTimer.localDate, {
          timer: runningTimer._id,
          entry: runningTimer.entryId,
        });
      }
    },
  });

  const open = useCallback(() => {
    const origin =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    originRef.current = origin;
    setFocused(resolveFocusedObject(origin));
    setQuery("");
    setView(ROOT_VIEW);
    setIsOpen(true);
  }, []);

  useShortcut(
    "app.command-palette",
    () => (isOpen ? setIsOpen(false) : open()),
    "app",
  );

  /** Sends an action to the page that owns it. See `lib/action-request.ts`. */
  function requestPageAction(
    to: "/backlog" | "/projects/$projectId",
    request: ActionRequest,
    projectId?: string,
  ) {
    void navigate({
      to,
      params: projectId ? { projectId } : undefined,
      search: request as never,
    } as never);
  }

  /**
   * Runs a project or task command on the Projects page. An open page gets the
   * request on its current route and applies its draft guard. Otherwise no
   * draft exists: `fallback` runs, or the request goes to `projectId`.
   */
  function requestProjectsPage(
    request: ActionRequest,
    projectId?: string,
    fallback?: () => void,
  ) {
    const { pathname } = router.state.location;
    if (pathname === "/projects" || pathname.startsWith("/projects/")) {
      void navigate({ to: ".", search: request as never });
    } else if (fallback) {
      fallback();
    } else if (projectId) {
      requestPageAction("/projects/$projectId", request, projectId);
    }
  }

  function run(command: PaletteCommand) {
    const snapshot = localStore.snapshot();
    switch (command.kind) {
      case "shortcut":
        shortcutRunner.run(command.shortcutId);
        return;
      case "navigate":
        void navigate({ to: command.to as never });
        return;
      case "show":
        return;
      case "open-project":
        requestProjectsPage(
          { action: "open-project", target: command.projectId },
          undefined,
          () =>
            void navigate({
              to: "/projects/$projectId",
              params: { projectId: command.projectId },
            }),
        );
        return;
      case "open-archive":
        requestProjectsPage(
          { action: "open-archive" },
          undefined,
          () => void navigate({ to: "/projects/archive" }),
        );
        return;
      case "create-project":
        requestProjectsPage({ action: "create-project" }, undefined, () =>
          setIsCreatingProject(true),
        );
        return;
      case "time-entry": {
        const entry = snapshot.timesheetEntries.find(
          (item) => item._id === command.entryId,
        );
        if (entry) {
          entryActions.runAction({ kind: "entry", entry }, command.actionId);
        }
        return;
      }
      case "running-entry":
        entryActions.runAction(
          { kind: "running", timerId: command.timerId },
          command.actionId,
        );
        return;
      case "task":
        if (command.actionId === "start-entry") {
          localStore.startTimer({
            projectId: command.projectId,
            taskId: command.taskId,
            accumulatedDurationMs: 0,
          });
        } else if (command.actionId === "new-entry") {
          openNewEntryEditor(
            {
              kind: "task",
              projectId: command.projectId,
              taskId: command.taskId,
            },
            { projectId: command.projectId, taskId: command.taskId },
          );
        } else {
          requestProjectsPage(
            {
              action: command.actionId,
              target: command.taskId,
              parent: command.projectId,
            },
            command.projectId,
          );
        }
        return;
      case "project":
        requestProjectsPage(
          { action: command.actionId, target: command.projectId },
          command.projectId,
        );
        return;
      case "backlog-item": {
        const workItem = snapshot.workItems.find(
          (item) => item._id === command.workItemId,
        );
        if (!workItem) return;
        // Edit and Add subitem open an editor: on the Backlog page when it is
        // open, which guards its draft, otherwise on the item's page.
        runBacklogItemAction(workItem, command.actionId, (hosted) => {
          if (router.state.location.pathname === "/backlog") {
            requestPageAction("/backlog", {
              action: hosted,
              target: workItem._id,
            });
            return;
          }
          void navigate({
            to: "/backlog/$itemId",
            params: { itemId: workItem._id },
            search: { action: hosted },
          });
        });
        return;
      }
      case "reorder":
        runReorder(command.target, command.step);
        return;
    }
  }

  /**
   * Move up and Move down. A time entry moves within its day here. Backlog
   * items, tasks and projects go to their page, which owns the visible order
   * and the task draft guard.
   */
  function runReorder(target: SortableObjectRef, step: -1 | 1) {
    const action = step === -1 ? "move-up" : "move-down";
    switch (target.kind) {
      case "time-entry": {
        const snapshot = localStore.snapshot();
        const entry = snapshot.timesheetEntries.find(
          (item) => item._id === target.entryId,
        );
        const next = entry
          ? getSharedTableStepOrder(
              selectSortableDayEntryIds(
                snapshot.timesheetEntries,
                entry.localDate,
                snapshot.timers[0]?.entryId,
              ),
              entry._id,
              step,
            )
          : null;
        if (entry && next) {
          localStore.reorderTimesheetEntries(entry.localDate, next.order);
        }
        return;
      }
      case "backlog-item":
        requestPageAction("/backlog", { action, target: target.workItemId });
        return;
      case "task":
        requestProjectsPage(
          { action, target: target.taskId, parent: target.projectId },
          target.projectId,
        );
        return;
      case "project":
        requestProjectsPage(
          { action, target: target.projectId },
          target.projectId,
        );
        return;
    }
  }

  function choose(item: PaletteItem) {
    if (item.disabledReason) return;
    if (item.command.kind === "show") {
      setView(item.command.view);
      setQuery("");
      return;
    }

    pendingCommandRef.current = item.command;
    setIsOpen(false);
  }

  function runPendingCommand() {
    const command = pendingCommandRef.current;
    pendingCommandRef.current = null;
    if (!command) return;

    const origin = originRef.current;
    if (origin?.isConnected && document.activeElement !== origin) {
      origin.focus({ preventScroll: true });
    }
    run(command);
  }

  // The registry is not reactive, so the list reads it while the palette is open.
  const sections = isOpen
    ? buildPaletteSections({
        query,
        view,
        focused,
        projects: state.projects,
        workItems: state.workItems,
        timesheetEntries: state.timesheetEntries,
        timer,
        shortcuts: SHORTCUTS.filter((shortcut) =>
          shortcutRunner.isAvailable(shortcut.id),
        ),
        // The narrow view's Projects page is the section itself, already listed.
        settingsPages: getSettingsPages(
          isNarrowView ? "narrow" : "wide",
          false,
          hasCalendar,
        ).filter((page) => page.to.startsWith("/settings/")),
        platform,
        settleOpensDialog,
      })
    : [];

  return (
    <>
      <CommandDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) runPendingCommand();
        }}
        title="Command palette"
        description="Search commands, projects, tasks and backlog items."
        className="sm:max-w-xl"
      >
        <Command
          shouldFilter={false}
          loop
          onKeyDown={(event) => {
            // Backspace in an empty field goes back to the main list.
            if (
              event.key === "Backspace" &&
              query === "" &&
              view.kind !== "root"
            ) {
              event.preventDefault();
              setView(ROOT_VIEW);
            }
          }}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={
              view.kind === "root"
                ? "Search commands, projects, tasks and backlog items"
                : "Filter actions"
            }
            aria-label="Search commands"
          />
          <CommandList className="max-h-[min(28rem,60dvh)]">
            <CommandEmpty>No results.</CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.id} heading={section.heading}>
                {section.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    disabled={Boolean(item.disabledReason)}
                    onSelect={() => choose(item)}
                    className={cn(item.destructive && "text-destructive")}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">
                        {item.label}
                        {item.detail ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {item.detail}
                          </span>
                        ) : null}
                      </span>
                      {/* Like the "…" menus: why it is disabled, else what it changes. */}
                      {item.disabledReason || item.hint ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          {item.disabledReason ?? item.hint}
                        </span>
                      ) : null}
                    </span>
                    {item.keys ? (
                      <CommandShortcut className="flex items-center gap-1 tracking-normal">
                        {item.keys.map((key, index) => (
                          <Fragment key={index}>
                            {index > 0 ? <span>then</span> : null}
                            <kbd className="min-w-5 rounded-md border border-border bg-muted px-1 text-center font-mono">
                              {key}
                            </kbd>
                          </Fragment>
                        ))}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>

      {entryActions.dialogs}
      {isCreatingProject ? (
        <ProjectFormDialog
          onClose={() => setIsCreatingProject(false)}
          onSubmit={(values) => {
            const projectId = localStore.addProject(values);
            setIsCreatingProject(false);
            void navigate({
              to: "/projects/$projectId",
              params: { projectId },
            });
          }}
        />
      ) : null}
    </>
  );
}
