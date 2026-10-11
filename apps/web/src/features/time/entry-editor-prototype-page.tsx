/**
 * PROTOTYPE, throwaway. Never merge to main.
 *
 * Question: what is the one editor for creating and editing a time entry, in Day and Week?
 * (wayfinder ticket "One entry editor for Day and Week", issue #14)
 *
 * Route: /prototype/entry-editor. The page shows one day's entries and a Week "Days" strip
 * so each host can be judged on both surfaces. Switch with `?editor=` or the floating bar:
 *   current: modal dialog (today's Week behavior)
 *   A: inline. The editor replaces the row or card it edits.
 *   B: popover. The editor floats next to the row, card or "+" that opened it.
 *   C: side panel. The editor docks on the right; the list stays visible and clickable.
 *
 * Every host uses the same form: TimeEntryFields, the shared draft rules, and the same keys:
 * Enter in Hours or Cmd/Ctrl+Enter anywhere saves, Escape cancels, outside click does nothing.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  RiAddLine as Plus,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiCloseLine as Close,
} from "@remixicon/react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import type { ProjectTaskSelection } from "@/features/projects/project-task-picker";
import {
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
} from "@/features/time/time-entry-editor";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import { TimeEntryFields } from "@/features/time/time-entry-fields";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";

type EditorVariant = "current" | "A" | "B" | "C";
const VARIANTS: { key: EditorVariant; name: string }[] = [
  { key: "current", name: "Modal" },
  { key: "A", name: "Inline" },
  { key: "B", name: "Popover" },
  { key: "C", name: "Side panel" },
];

/** What the editor is open on: an entry, or a new entry for a date. */
type EditorTarget = (
  | { kind: "edit"; entry: LocalTimesheetEntry }
  | { kind: "create"; localDate: string }
) & { anchor: HTMLElement | null; surface: "day" | "week" };

function readVariant(): EditorVariant {
  const value = new URLSearchParams(window.location.search).get("editor");
  return VARIANTS.some((variant) => variant.key === value)
    ? (value as EditorVariant)
    : "A";
}

function formatDay(localDate: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", options).format(
    new Date(`${localDate}T12:00:00`),
  );
}

/* ── The one form, shared by every host ── */

function EntryEditorForm({
  target,
  onDone,
  compact = false,
}: {
  target: EditorTarget;
  onDone: () => void;
  compact?: boolean;
}) {
  const projects = useLocalProjects();
  const state = useLocalState();
  const entry = target.kind === "edit" ? target.entry : undefined;
  const localDate =
    entry?.localDate ??
    (target.kind === "create" ? target.localDate : todayIsoDate());
  const [fields, setFields] = useState(() =>
    createTimeEntryEditorFields(entry),
  );
  const editor = evaluateTimeEntryEditor(fields, {
    original: entry,
    allowEmptyDuration: !entry,
  });
  const entryActions = useTimeEntryActions({
    onEdit: () => undefined,
    onAfterAction: onDone,
  });
  const hasTimer = state.timers.length > 0;

  function save() {
    if (!editor.canSave || !editor.values) return;
    if (editor.isTimerMode && !entry) {
      startTimer();
      return;
    }
    if (entry) {
      localStore.updateTimesheetEntry(entry._id, editor.values);
    } else {
      localStore.saveManualTimeEntry({ ...editor.values, localDate });
    }
    onDone();
  }

  function startTimer() {
    if (entry) {
      if (!editor.canSave || !editor.values) return;
      localStore.updateTimesheetEntry(entry._id, editor.values);
      localStore.continueTimesheetEntry(entry._id);
    } else {
      localStore.startTimer({ localDate, ...editor.metadata });
    }
    onDone();
  }

  function handleAction(actionId: TimeEntryActionId) {
    if (!entry) return;
    if (actionId === "continue") {
      startTimer();
      return;
    }
    entryActions.runAction({ kind: "entry", entry }, actionId, {
      resolveValues: editor.relocationValues,
    });
  }

  return (
    <div
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          save();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {entry ? "Edit time entry" : "New time entry"}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {formatDay(localDate, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {entry ? (
            <ObjectActionsButton
              actions={entryActions.getActions(
                { kind: "entry", entry },
                {
                  isEditing: true,
                  invalidDraftReason: editor.canSave
                    ? undefined
                    : "Enter a valid duration first",
                },
              )}
              onAction={handleAction}
              label="Entry actions"
            />
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel"
            onClick={onDone}
          >
            <Close />
          </Button>
        </div>
      </div>
      <TimeEntryFields
        idPrefix={`prototype-${entry?._id ?? "new"}`}
        className={
          compact ? "grid gap-3" : "sm:grid sm:grid-cols-[minmax(0,1fr)_7rem]"
        }
        projects={projects}
        projectId={fields.projectId}
        taskId={fields.taskId}
        note={fields.note}
        durationHours={fields.durationHours}
        durationError={editor.durationError}
        onProjectTaskChange={(selection: ProjectTaskSelection) =>
          setFields((current) => ({
            ...current,
            projectId: selection.projectId,
            taskId: selection.taskId,
          }))
        }
        onNoteChange={(note) => setFields((current) => ({ ...current, note }))}
        onDurationChange={(durationHours) =>
          setFields((current) => ({ ...current, durationHours }))
        }
        onDurationKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          ⌘↵ save · Esc cancel
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entry ? !editor.canSave : editor.durationMs === null}
            onClick={startTimer}
          >
            {entry ? "Continue" : hasTimer ? "Switch timer" : "Start timer"}
          </Button>
          <Button size="sm" disabled={!editor.canSave} onClick={save}>
            Save
          </Button>
        </div>
      </div>
      {entryActions.dialogs}
    </div>
  );
}

/* ── Surfaces: Day list and Week "Days" strip ── */

function useSurfaceData(anchorDate: string) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const weekDates = useMemo(() => getIsoWeekDates(anchorDate), [anchorDate]);
  const byDate = useMemo(() => {
    const map = new Map<string, LocalTimesheetEntry[]>();
    for (const date of weekDates) map.set(date, []);
    for (const entry of state.timesheetEntries) {
      map.get(entry.localDate)?.push(entry);
    }
    return map;
  }, [state.timesheetEntries, weekDates]);
  const describe = (entry: LocalTimesheetEntry) => {
    const project = projects.find((item) => item._id === entry.projectId);
    const task = project?.tasks.find((item) => item._id === entry.taskId);
    return {
      project: project ? getLocalProjectDisplayName(project) : "No project",
      color: project?.color ?? "#94a3b8",
      task: task?.name ?? "No task",
    };
  };
  return { weekDates, byDate, describe };
}

interface SurfaceProps {
  anchorDate: string;
  target: EditorTarget | null;
  /** Inline hosts render the editor in place of the item being edited. */
  renderInline?: (target: EditorTarget) => ReactNode;
  onOpen: (target: EditorTarget) => void;
}

function isTarget(
  target: EditorTarget | null,
  surface: "day" | "week",
  entryId?: string,
  createDate?: string,
) {
  if (!target || target.surface !== surface) return false;
  return target.kind === "edit"
    ? target.entry._id === entryId
    : target.localDate === createDate && !entryId;
}

function DaySurface({
  anchorDate,
  target,
  renderInline,
  onOpen,
}: SurfaceProps) {
  const { byDate, describe } = useSurfaceData(anchorDate);
  const entries = byDate.get(anchorDate) ?? [];
  return (
    <section className="rounded-xl border border-border">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Day ·{" "}
          {formatDay(anchorDate, {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) =>
            onOpen({
              kind: "create",
              localDate: anchorDate,
              anchor: event.currentTarget,
              surface: "day",
            })
          }
        >
          <Plus data-icon="inline-start" /> New entry
        </Button>
      </header>
      {renderInline && isTarget(target, "day", undefined, anchorDate) ? (
        <div className="border-b border-border bg-muted/40 p-3">
          {renderInline(target!)}
        </div>
      ) : null}
      {entries.map((entry) => {
        const info = describe(entry);
        if (renderInline && isTarget(target, "day", entry._id)) {
          return (
            <div
              key={entry._id}
              className="border-b border-border bg-muted/40 p-3"
            >
              {renderInline(target!)}
            </div>
          );
        }
        return (
          <button
            key={entry._id}
            type="button"
            onClick={(event) =>
              onOpen({
                kind: "edit",
                entry,
                anchor: event.currentTarget,
                surface: "day",
              })
            }
            className={cn(
              "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/50",
              isTarget(target, "day", entry._id) && "bg-muted",
            )}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: info.color }}
            />
            <span className="w-32 shrink-0 truncate text-sm">
              {info.project}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {info.task}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {entry.note}
              </span>
            </span>
            <span className="font-mono text-xs">
              {formatClockDuration(entry.durationMs)}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function WeekSurface({
  anchorDate,
  target,
  renderInline,
  onOpen,
}: SurfaceProps) {
  const { weekDates, byDate, describe } = useSurfaceData(anchorDate);
  return (
    <section className="rounded-xl border border-border">
      <header className="border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Week · Days layout
      </header>
      <div className="grid grid-cols-7 divide-x divide-border">
        {weekDates.map((localDate) => (
          <div key={localDate} className="flex min-w-0 flex-col gap-1.5 p-1.5">
            <div className="px-1 text-xs font-semibold">
              {formatDay(localDate, { weekday: "short", day: "numeric" })}
            </div>
            {(byDate.get(localDate) ?? []).map((entry) => {
              const info = describe(entry);
              if (renderInline && isTarget(target, "week", entry._id)) {
                return (
                  <div
                    key={entry._id}
                    className="rounded-lg border border-border bg-background p-2 shadow-sm"
                  >
                    {renderInline(target!)}
                  </div>
                );
              }
              return (
                <button
                  key={entry._id}
                  type="button"
                  onClick={(event) =>
                    onOpen({
                      kind: "edit",
                      entry,
                      anchor: event.currentTarget,
                      surface: "week",
                    })
                  }
                  style={{ "--c": info.color } as CSSProperties}
                  className={cn(
                    "rounded-lg border border-l-[3px] border-border border-l-[var(--c)] p-1.5 text-left hover:bg-muted/50",
                    isTarget(target, "week", entry._id) && "bg-muted",
                  )}
                >
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {info.project}
                  </span>
                  <span className="block truncate text-xs font-medium">
                    {info.task}
                  </span>
                  <span className="font-mono text-[10px]">
                    {formatClockDuration(entry.durationMs)}
                  </span>
                </button>
              );
            })}
            {renderInline && isTarget(target, "week", undefined, localDate) ? (
              <div className="rounded-lg border border-border bg-background p-2 shadow-sm">
                {renderInline(target!)}
              </div>
            ) : (
              <button
                type="button"
                onClick={(event) =>
                  onOpen({
                    kind: "create",
                    localDate,
                    anchor: event.currentTarget,
                    surface: "week",
                  })
                }
                className="rounded-md py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                + Add
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Hosts ── */

function PopoverHost({
  target,
  onDone,
}: {
  target: EditorTarget;
  onDone: () => void;
}) {
  const rect = target.anchor?.getBoundingClientRect();
  const width = 400;
  const left = rect
    ? Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
    : window.innerWidth / 2 - width / 2;
  const below = rect ? rect.bottom + 6 : 120;
  const top = Math.min(below, window.innerHeight - 360);
  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" />
      <div
        className="fixed z-50 rounded-2xl border border-border bg-popover p-4 shadow-xl"
        style={{ left, top, width }}
      >
        <EntryEditorForm target={target} onDone={onDone} compact />
      </div>
    </>
  );
}

function SidePanelHost({
  target,
  onDone,
}: {
  target: EditorTarget;
  onDone: () => void;
}) {
  return (
    <aside className="sticky top-0 h-fit w-[380px] shrink-0 rounded-xl border border-border bg-[var(--surface-low)] p-4">
      <EntryEditorForm
        key={
          target.kind === "edit" ? target.entry._id : `new-${target.localDate}`
        }
        target={target}
        onDone={onDone}
        compact
      />
    </aside>
  );
}

export function EntryEditorPrototypePage() {
  const [variant, setVariant] = useState<EditorVariant>(readVariant);
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const anchorDate = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("date");
    return value ?? todayIsoDate();
  }, []);
  const close = useCallback(() => setTarget(null), []);

  const cycle = useCallback(
    (step: number) => {
      const index = VARIANTS.findIndex((item) => item.key === variant);
      const next =
        VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.key;
      const url = new URL(window.location.href);
      url.searchParams.set("editor", next);
      window.history.replaceState(window.history.state, "", url);
      setTarget(null);
      setVariant(next);
    },
    [variant],
  );
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") cycleRef.current(-1);
      if (event.key === "ArrowRight") cycleRef.current(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const renderInline =
    variant === "A"
      ? (inlineTarget: EditorTarget) => (
          <EntryEditorForm
            key={
              inlineTarget.kind === "edit"
                ? inlineTarget.entry._id
                : `new-${inlineTarget.localDate}`
            }
            target={inlineTarget}
            onDone={close}
            compact
          />
        )
      : undefined;
  const surfaceProps = { anchorDate, target, renderInline, onOpen: setTarget };
  const current = VARIANTS.find((item) => item.key === variant)!;

  return (
    <div className="flex gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <DaySurface {...surfaceProps} />
        <WeekSurface {...surfaceProps} />
      </div>
      {variant === "C" && target ? (
        <SidePanelHost target={target} onDone={close} />
      ) : null}
      {variant === "B" && target ? (
        <PopoverHost target={target} onDone={close} />
      ) : null}
      {variant === "current" ? (
        <Dialog
          open={target !== null}
          onOpenChange={(open) => !open && close()}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader className="sr-only">
              <DialogTitle>Time entry</DialogTitle>
            </DialogHeader>
            {target ? <EntryEditorForm target={target} onDone={close} /> : null}
          </DialogContent>
        </Dialog>
      ) : null}
      {import.meta.env.PROD ? null : (
        <div className="fixed bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-600 px-2 py-1 text-xs font-semibold text-white shadow-lg">
          <button
            type="button"
            onClick={() => cycle(-1)}
            aria-label="Previous variant"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span>
            Editor {current.key}: {current.name} · Alt+←/→
          </span>
          <button
            type="button"
            onClick={() => cycle(1)}
            aria-label="Next variant"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
