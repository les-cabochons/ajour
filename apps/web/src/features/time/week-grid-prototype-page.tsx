/**
 * PROTOTYPE, throwaway. Never merge to main.
 *
 * Question: how does the user add and change time in the Week Grid?
 * (wayfinder ticket "Adding and changing time in the week view", issue #16)
 *
 * Route: /prototype/week-grid. One Week Grid (task rows by day) with the side panel
 * from the entry editor decision. Switch with `?grid=` or the floating bar:
 *   A: panel only. Cells are buttons. A click opens the side panel: a new entry for
 *      that task and day, or the list of the cell's entries.
 *   B: typed cells. Every cell is an hours input (Harvest style). Typing creates or
 *      changes the entry, clearing deletes it, Tab moves across days. Cells holding
 *      several entries are read-only and open the panel.
 *   C: typed on demand. A click selects the cell and opens the panel like A.
 *      Double-click, Enter, or typing a digit edits the hours in place like B.
 * "+ Add row" picks a task and adds an empty row in every variant.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine as Plus,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  formatClockDuration,
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import { ProjectTaskPicker } from "@/features/projects/project-task-picker";
import {
  EntryEditorForm,
  type EditorTarget,
} from "@/features/time/entry-editor-prototype-page";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";

type GridVariant = "A" | "B" | "C";
const VARIANTS: { key: GridVariant; name: string }[] = [
  { key: "A", name: "Panel only" },
  { key: "B", name: "Typed cells" },
  { key: "C", name: "Typed on demand" },
];

interface Row {
  key: string;
  projectId?: string;
  taskId?: string;
}

/** What the side panel shows: the editor, or the entries of one cell. */
type PanelState =
  | { kind: "editor"; target: EditorTarget }
  | { kind: "cell"; row: Row; localDate: string }
  | null;

function readVariant(): GridVariant {
  const value = new URLSearchParams(window.location.search).get("grid");
  return VARIANTS.some((item) => item.key === value)
    ? (value as GridVariant)
    : "A";
}

function dayLabel(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${localDate}T12:00:00`));
}

function rowKey(projectId?: string, taskId?: string) {
  return `${projectId ?? "-"}:${taskId ?? "-"}`;
}

/** Writes a typed cell value: create, change the single entry, or delete it. */
function commitCell(
  row: Row,
  localDate: string,
  entries: LocalTimesheetEntry[],
  text: string,
) {
  const durationMs = text.trim() ? parseHoursInput(text) : 0;
  if (durationMs === null) return false;
  const [entry] = entries;
  if (!entry) {
    if (durationMs > 0) {
      localStore.saveManualTimeEntry({
        localDate,
        projectId: row.projectId,
        taskId: row.taskId,
        durationMs,
      });
    }
  } else if (durationMs === 0) {
    localStore.deleteTimesheetEntry(entry._id);
  } else if (durationMs !== entry.durationMs) {
    localStore.updateTimesheetEntry(entry._id, {
      projectId: entry.projectId,
      taskId: entry.taskId,
      note: entry.note,
      durationMs,
    });
  }
  return true;
}

function TypedCell({
  row,
  localDate,
  entries,
  autoFocus,
  initialText,
  onDone,
}: {
  row: Row;
  localDate: string;
  entries: LocalTimesheetEntry[];
  autoFocus?: boolean;
  initialText?: string;
  onDone?: () => void;
}) {
  const saved = entries[0]
    ? formatDurationHoursInput(entries[0].durationMs)
    : "";
  const [text, setText] = useState(initialText ?? saved);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(initialText ?? saved), [saved, initialText]);
  function commit() {
    const ok = commitCell(row, localDate, entries, text);
    setInvalid(!ok);
    if (ok) onDone?.();
  }
  return (
    <input
      autoFocus={autoFocus}
      value={text}
      placeholder="—"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setText(saved);
          onDone?.();
        }
      }}
      aria-label={`Hours on ${localDate}`}
      className={cn(
        "h-8 w-full rounded-md border border-transparent bg-transparent text-center font-mono text-xs outline-none hover:border-border focus:border-ring focus:bg-background",
        invalid && "border-destructive",
      )}
    />
  );
}

export function WeekGridPrototypePage() {
  const state = useLocalState();
  const projects = useLocalProjects();
  const [variant, setVariant] = useState<GridVariant>(readVariant);
  const anchorDate = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("date") ?? todayIsoDate(),
    [],
  );
  const weekDates = useMemo(() => getIsoWeekDates(anchorDate), [anchorDate]);
  const [extraRows, setExtraRows] = useState<Row[]>([]);
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [panel, setPanel] = useState<PanelState>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{
    key: string;
    initial?: string;
  } | null>(null);

  const weekEntries = useMemo(
    () =>
      state.timesheetEntries.filter((entry) =>
        weekDates.includes(entry.localDate),
      ),
    [state.timesheetEntries, weekDates],
  );
  const rows = useMemo(() => {
    const seen = new Map<string, Row>();
    for (const entry of weekEntries) {
      const key = rowKey(entry.projectId, entry.taskId);
      if (!seen.has(key))
        seen.set(key, {
          key,
          projectId: entry.projectId,
          taskId: entry.taskId,
        });
    }
    for (const row of extraRows) if (!seen.has(row.key)) seen.set(row.key, row);
    return [...seen.values()];
  }, [weekEntries, extraRows]);
  const cellEntries = (row: Row, localDate: string) =>
    weekEntries.filter(
      (entry) =>
        entry.localDate === localDate &&
        rowKey(entry.projectId, entry.taskId) === row.key,
    );
  const describe = (row: Row) => {
    const project = projects.find((item) => item._id === row.projectId);
    const task = project?.tasks.find((item) => item._id === row.taskId);
    return {
      project: project ? getLocalProjectDisplayName(project) : "No project",
      task: task?.name ?? "No task",
      color: project?.color ?? "#94a3b8",
    };
  };

  function openCell(row: Row, localDate: string, anchor: HTMLElement) {
    const entries = cellEntries(row, localDate);
    if (entries.length === 0) {
      setPanel({
        kind: "editor",
        target: {
          kind: "create",
          localDate,
          projectId: row.projectId,
          taskId: row.taskId,
          anchor,
          surface: "grid",
        },
      });
    } else if (entries.length === 1) {
      setPanel({
        kind: "editor",
        target: { kind: "edit", entry: entries[0]!, anchor, surface: "grid" },
      });
    } else {
      setPanel({ kind: "cell", row, localDate });
    }
  }

  function cycle(step: number) {
    const index = VARIANTS.findIndex((item) => item.key === variant);
    const next =
      VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.key;
    const url = new URL(window.location.href);
    url.searchParams.set("grid", next);
    window.history.replaceState(window.history.state, "", url);
    setPanel(null);
    setSelected(null);
    setEditingCell(null);
    setVariant(next);
  }
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

  const dayTotals = weekDates.map((localDate) =>
    weekEntries
      .filter((entry) => entry.localDate === localDate)
      .reduce((sum, entry) => sum + entry.durationMs, 0),
  );
  const current = VARIANTS.find((item) => item.key === variant)!;

  function renderCell(row: Row, localDate: string) {
    const entries = cellEntries(row, localDate);
    const total = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
    const cellKey = `${row.key}@${localDate}`;
    const isMulti = entries.length > 1;
    const display = (
      <span className="flex items-center justify-center gap-1">
        {total ? (
          formatClockDuration(total)
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
        {isMulti ? (
          <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
            ×{entries.length}
          </span>
        ) : null}
      </span>
    );

    if (variant === "B" && !isMulti) {
      return (
        <TypedCell
          key={cellKey}
          row={row}
          localDate={localDate}
          entries={entries}
        />
      );
    }
    if (variant === "C" && editingCell?.key === cellKey && !isMulti) {
      return (
        <TypedCell
          row={row}
          localDate={localDate}
          entries={entries}
          autoFocus
          initialText={editingCell.initial}
          onDone={() => setEditingCell(null)}
        />
      );
    }
    return (
      <button
        type="button"
        onClick={(event) => {
          setSelected(cellKey);
          openCell(row, localDate, event.currentTarget);
        }}
        onDoubleClick={() =>
          variant === "C" && !isMulti && setEditingCell({ key: cellKey })
        }
        onKeyDown={(event) => {
          if (variant !== "C" || isMulti) return;
          if (event.key === "Enter") {
            event.preventDefault();
            setEditingCell({ key: cellKey });
          } else if (/^[0-9]$/.test(event.key)) {
            event.preventDefault();
            setEditingCell({ key: cellKey, initial: event.key });
          }
        }}
        className={cn(
          "h-8 w-full rounded-md font-mono text-xs hover:bg-muted",
          selected === cellKey && panel && "bg-muted ring-1 ring-ring",
        )}
      >
        {display}
      </button>
    );
  }

  return (
    <div className="flex gap-4 p-4">
      <section className="min-w-0 flex-1 rounded-xl border border-border">
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Week · Grid
          </span>
          <span className="text-[11px] text-muted-foreground">
            {variant === "A"
              ? "Click a cell to open it in the panel"
              : variant === "B"
                ? "Type hours in a cell · Tab moves to the next day · clear to delete"
                : "Click opens the panel · double-click, Enter or a digit edits in place"}
          </span>
        </header>
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="w-56 px-3 py-2 text-left font-medium">
                Project / task
              </th>
              {weekDates.map((localDate) => (
                <th key={localDate} className="py-2 font-medium">
                  {dayLabel(localDate)}
                </th>
              ))}
              <th className="w-16 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const info = describe(row);
              const rowTotal = weekEntries
                .filter(
                  (entry) => rowKey(entry.projectId, entry.taskId) === row.key,
                )
                .reduce((sum, entry) => sum + entry.durationMs, 0);
              return (
                <tr key={row.key} className="border-b border-border">
                  <td className="px-3 py-1">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: info.color }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {info.project}
                        </span>
                        <span className="block truncate text-sm font-medium">
                          {info.task}
                        </span>
                      </span>
                    </span>
                  </td>
                  {weekDates.map((localDate) => (
                    <td key={localDate} className="px-1 py-1">
                      {renderCell(row, localDate)}
                    </td>
                  ))}
                  <td className="text-center font-mono text-xs font-semibold">
                    {rowTotal ? formatClockDuration(rowTotal) : "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="border-b border-border">
              <td className="px-3 py-1.5" colSpan={9}>
                {isAddingRow ? (
                  <div className="flex items-center gap-2">
                    <div className="w-80">
                      <ProjectTaskPicker
                        projects={projects}
                        projectId=""
                        taskId=""
                        onChange={(selection) => {
                          if (selection.projectId) {
                            setExtraRows((current) => [
                              ...current,
                              {
                                key: rowKey(
                                  selection.projectId || undefined,
                                  selection.taskId || undefined,
                                ),
                                projectId: selection.projectId || undefined,
                                taskId: selection.taskId || undefined,
                              },
                            ]);
                            setIsAddingRow(false);
                          }
                        }}
                        placeholder="Pick a project or task for the new row"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAddingRow(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddingRow(true)}
                  >
                    <Plus data-icon="inline-start" /> Add row
                  </Button>
                )}
              </td>
            </tr>
            <tr className="text-xs font-semibold">
              <td className="px-3 py-2 tracking-wide text-muted-foreground uppercase">
                Daily totals
              </td>
              {dayTotals.map((total, index) => (
                <td key={weekDates[index]} className="text-center font-mono">
                  {total ? formatClockDuration(total) : "—"}
                </td>
              ))}
              <td className="text-center font-mono">
                {formatClockDuration(
                  dayTotals.reduce((sum, value) => sum + value, 0),
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {panel ? (
        <aside className="sticky top-0 h-fit w-[380px] shrink-0 rounded-xl border border-border bg-[var(--surface-low)] p-4">
          {panel.kind === "editor" ? (
            <EntryEditorForm
              key={
                panel.target.kind === "edit"
                  ? panel.target.entry._id
                  : `new-${panel.target.localDate}-${panel.target.taskId}`
              }
              target={panel.target}
              onDone={() => setPanel(null)}
              compact
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold">
                {describe(panel.row).task} · {dayLabel(panel.localDate)}
              </div>
              {cellEntries(panel.row, panel.localDate).map((entry) => (
                <button
                  key={entry._id}
                  type="button"
                  onClick={(event) =>
                    setPanel({
                      kind: "editor",
                      target: {
                        kind: "edit",
                        entry,
                        anchor: event.currentTarget,
                        surface: "grid",
                      },
                    })
                  }
                  className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="truncate text-sm">
                    {entry.note || "No note"}
                  </span>
                  <span className="font-mono text-xs">
                    {formatClockDuration(entry.durationMs)}
                  </span>
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) =>
                  setPanel({
                    kind: "editor",
                    target: {
                      kind: "create",
                      localDate: panel.localDate,
                      projectId: panel.row.projectId,
                      taskId: panel.row.taskId,
                      anchor: event.currentTarget,
                      surface: "grid",
                    },
                  })
                }
              >
                <Plus data-icon="inline-start" /> Add another entry
              </Button>
            </div>
          )}
        </aside>
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
            Grid {current.key}: {current.name} · Alt+←/→
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
