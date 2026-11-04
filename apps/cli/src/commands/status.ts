import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../../packages/shared/agent-tools.ts";
import type { AjourClient } from "../client.ts";
import { localDate, type Context } from "../context.ts";
import { UnreachableError } from "../errors.ts";
import { painter, type Paint } from "../format/style.ts";
import { formatClock, formatClockSeconds, truncate } from "../format/text.ts";

export interface StatusOptions {
  /** One line for a status bar. */
  short: boolean;
  /** What the one line says when nothing runs. */
  idle: string;
  /** Redraw each second until q or Ctrl-C. */
  watch: boolean;
}

/** How often `--watch` asks Ajour again. Between asks, the clock ticks here. */
const WATCH_REFRESH_MS = 10_000;

interface Snapshot {
  running: AgentRunningTimer | null;
  today: string;
  /** Today's saved time, without the part the running entry counts again. */
  savedTodayMinutes: number;
  /** The entry saved most recently today, for the idle line. */
  last?: { label: string; savedAt: number };
}

export async function status(
  ctx: Context,
  options: StatusOptions,
): Promise<number> {
  if (options.short) return shortStatus(ctx, options);
  const client = await ctx.client();
  if (ctx.json) {
    const output = await client.call("get_running_timer", {});
    ctx.io.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 0;
  }
  const columns = ctx.io.stdout.isTTY ? ctx.io.stdout.columns : undefined;
  if (!options.watch || !ctx.io.stdout.isTTY) {
    const snapshot = await readSnapshot(ctx, client);
    ctx.io.stdout.write(renderLong(snapshot, ctx, columns));
    return 0;
  }
  return watch(ctx, client);
}

/**
 * A status bar runs this every few seconds, so it never prints an error:
 * while Ajour is out of reach it prints nothing and exits 0. With --watch it
 * streams one line per second, for bars that read a stream, and an empty
 * line while Ajour is out of reach.
 */
async function shortStatus(
  ctx: Context,
  options: StatusOptions,
): Promise<number> {
  // Status bars rarely read escape codes, so color only when asked.
  const paint = painter(ctx.color === "always");
  const read = async (): Promise<
    { running: AgentRunningTimer | null } | undefined
  > => {
    try {
      return await (await ctx.client()).call("get_running_timer", {});
    } catch (error) {
      if (error instanceof UnreachableError) return undefined;
      throw error;
    }
  };
  const line = (state: { running: AgentRunningTimer | null } | undefined) => {
    const running = state?.running;
    if (running) {
      return `${paint.success("●")} ${formatClock(running.countedMinutes)} ${titleOf(running)}\n`;
    }
    if (state && options.idle) return `${oneLine(options.idle)}\n`;
    return options.watch ? "\n" : "";
  };

  let state = await read();
  if (!options.watch) {
    ctx.io.stdout.write(line(state));
    return 0;
  }
  let readAt = ctx.io.now();
  try {
    for (;;) {
      const elapsed = Math.floor((ctx.io.now() - readAt) / 1000);
      ctx.io.stdout.write(
        line(state && { running: advance(state.running, elapsed) }),
      );
      if (!(await ctx.io.wait(1000))) return 0;
      if (ctx.io.now() - readAt >= WATCH_REFRESH_MS) {
        state = await read();
        readAt = ctx.io.now();
      }
    }
  } finally {
    ctx.io.releaseInput();
  }
}

/**
 * Today's entries and the running entry come from one read, so a Stop
 * between two reads can't count an entry twice. Only a running entry from
 * another day, past midnight, needs a second read; it isn't today's time.
 */
async function readSnapshot(
  ctx: Context,
  client: AjourClient,
): Promise<Snapshot> {
  const today = localDate(ctx.io.now());
  const listed = await client.call("list_time_entries", {
    from: today,
    to: today,
  });
  let running = listed.running;
  if (!running) {
    const current = (await client.call("get_running_timer", {})).running;
    if (current && current.date !== today) running = current;
  }
  return {
    running,
    today,
    savedTodayMinutes: savedMinutes(listed.entries),
    last: lastSaved(listed.entries),
  };
}

/**
 * The entry a running entry continues lists its saved part; the running
 * entry counts that part again. So it is left out here.
 */
function savedMinutes(entries: readonly AgentTimeEntry[]): number {
  return entries
    .filter((entry) => entry.state !== "running")
    .reduce((total, entry) => total + entry.minutes, 0);
}

function lastSaved(
  entries: readonly AgentTimeEntry[],
): Snapshot["last"] | undefined {
  let last: Snapshot["last"];
  for (const entry of entries) {
    if (entry.state === "running" || !entry.savedAt) continue;
    const savedAt = Date.parse(entry.savedAt);
    if (Number.isNaN(savedAt) || (last && last.savedAt >= savedAt)) continue;
    const label = entry.taskName || entry.projectName || entry.note;
    if (label) last = { label: oneLine(label), savedAt };
  }
  return last;
}

function todayMinutes(snapshot: Snapshot): number {
  const { running } = snapshot;
  return (
    snapshot.savedTodayMinutes +
    (running && running.date === snapshot.today ? running.countedMinutes : 0)
  );
}

/** The backlog item's title, else the note, the task or the project. */
function titleOf(running: AgentRunningTimer): string {
  return oneLine(
    running.workItemTitle?.trim() ||
      running.note?.trim() ||
      running.taskName ||
      running.projectName ||
      "Untitled entry",
  );
}

/** Notes may hold line breaks; a status line never does. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The two lines, or one when idle, each cut to one column less than the
 * terminal, so no line wraps and --watch can clear exactly what it drew.
 */
function renderLong(
  snapshot: Snapshot,
  ctx: Context,
  columns: number | undefined,
): string {
  const { paint } = ctx;
  const width = columns ? Math.max(columns - 1, 1) : Number.POSITIVE_INFINITY;
  const fit = (text: string, used: number) =>
    Number.isFinite(width) ? truncate(text, width - used) : text;
  const today = `today ${formatClock(todayMinutes(snapshot))}`;
  const { running } = snapshot;

  if (!running) {
    const last = snapshot.last
      ? ` · last: ${snapshot.last.label}, ${ago(ctx.io.now() - snapshot.last.savedAt)}`
      : "";
    return `${paint.muted("○")} ${fit(`Nothing running · ${today}${last}`, 2)}\n`;
  }

  const clock =
    running.countedSeconds === undefined
      ? formatClock(running.countedMinutes)
      : formatClockSeconds(running.countedSeconds);
  const details = [
    running.projectCode || running.projectName,
    running.taskName,
    running.runningSince
      ? `since ${timeOfDay(running.runningSince)}`
      : undefined,
    running.date === snapshot.today ? undefined : `started ${running.date}`,
    today,
  ].filter(Boolean);
  return (
    `${paint.success("●")} ${paint.bold(clock)}  ${fit(titleOf(running), clock.length + 4)}\n` +
    `  ${paint.muted(fit(details.join(" · "), 2))}\n`
  );
}

/** "45m ago", "3h ago" or "2d ago", as the task menu shows recent tasks. */
function ago(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeOfDay(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The running entry `seconds` later, so the clock ticks between asks. */
function advance(
  running: AgentRunningTimer | null,
  seconds: number,
): AgentRunningTimer | null {
  if (!running || seconds <= 0) return running;
  const countedSeconds =
    (running.countedSeconds ?? running.countedMinutes * 60) + seconds;
  return {
    ...running,
    countedSeconds,
    countedMinutes: Math.floor(countedSeconds / 60),
  };
}

async function watch(ctx: Context, client: AjourClient): Promise<number> {
  let snapshot = await readSnapshot(ctx, client);
  let readAt = ctx.io.now();
  let shownLines = 0;
  try {
    for (;;) {
      const elapsed = Math.floor((ctx.io.now() - readAt) / 1000);
      const frame = renderLong(
        { ...snapshot, running: advance(snapshot.running, elapsed) },
        ctx,
        ctx.io.stdout.columns,
      );
      // Move up over the last frame and clear it, then draw the new one.
      if (shownLines) ctx.io.stdout.write(`\x1b[${shownLines}F\x1b[J`);
      ctx.io.stdout.write(frame);
      shownLines = frame.split("\n").length - 1;
      if (!(await ctx.io.wait(1000))) return 0;
      if (ctx.io.now() - readAt >= WATCH_REFRESH_MS) {
        snapshot = await readSnapshot(ctx, client);
        readAt = ctx.io.now();
      }
    }
  } finally {
    ctx.io.releaseInput();
  }
}
