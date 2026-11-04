import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../../packages/shared/agent-tools.ts";
import type { AjourClient } from "../client.ts";
import { localDate, type Context } from "../context.ts";
import { UnreachableError } from "../errors.ts";
import { painter, type Paint } from "../format/style.ts";
import { formatClock, formatClockSeconds } from "../format/text.ts";

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
  /** Today's saved time without the running entry's part. */
  savedTodayMinutes: number;
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
  if (!options.watch || !ctx.io.stdout.isTTY) {
    ctx.io.stdout.write(renderLong(await readSnapshot(ctx, client), ctx.paint));
    return 0;
  }
  return watch(ctx, client);
}

/**
 * A status bar runs this every few seconds, so it never prints an error:
 * while Ajour is out of reach it prints nothing and exits 0.
 */
async function shortStatus(
  ctx: Context,
  options: StatusOptions,
): Promise<number> {
  let running: AgentRunningTimer | null;
  try {
    running = (await (await ctx.client()).call("get_running_timer", {}))
      .running;
  } catch (error) {
    if (error instanceof UnreachableError) return 0;
    throw error;
  }
  // Status bars rarely read escape codes, so color only when asked.
  const paint = painter(ctx.color === "always");
  if (running) {
    ctx.io.stdout.write(
      `${paint.success("●")} ${formatClock(running.countedMinutes)} ${titleOf(running)}\n`,
    );
  } else if (options.idle) {
    ctx.io.stdout.write(`${options.idle}\n`);
  }
  return 0;
}

async function readSnapshot(
  ctx: Context,
  client: AjourClient,
): Promise<Snapshot> {
  const today = localDate(ctx.io.now());
  const [{ running }, { entries }] = await Promise.all([
    client.call("get_running_timer", {}),
    client.call("list_time_entries", { from: today, to: today }),
  ]);
  return { running, today, savedTodayMinutes: savedMinutes(entries) };
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

function todayMinutes(snapshot: Snapshot): number {
  const { running } = snapshot;
  return (
    snapshot.savedTodayMinutes +
    (running && running.date === snapshot.today ? running.countedMinutes : 0)
  );
}

/** The backlog item's title, else the note, the task or the project. */
function titleOf(running: AgentRunningTimer): string {
  return (
    running.workItemTitle?.trim() ||
    running.note?.trim() ||
    running.taskName ||
    running.projectName ||
    "Untitled entry"
  );
}

function renderLong(snapshot: Snapshot, paint: Paint): string {
  const today = `today ${formatClock(todayMinutes(snapshot))}`;
  const { running } = snapshot;
  if (!running) return `${paint.muted("○")} Nothing running · ${today}\n`;

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
    `${paint.success("●")} ${paint.bold(clock)}  ${titleOf(running)}\n` +
    `  ${paint.muted(details.join(" · "))}\n`
  );
}

function timeOfDay(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The snapshot `seconds` later, so the clock ticks between asks. */
function advance(snapshot: Snapshot, seconds: number): Snapshot {
  const { running } = snapshot;
  if (!running || seconds <= 0) return snapshot;
  const countedSeconds =
    (running.countedSeconds ?? running.countedMinutes * 60) + seconds;
  return {
    ...snapshot,
    running: {
      ...running,
      countedSeconds,
      countedMinutes: Math.floor(countedSeconds / 60),
    },
  };
}

async function watch(ctx: Context, client: AjourClient): Promise<number> {
  let snapshot = await readSnapshot(ctx, client);
  let readAt = ctx.io.now();
  let shownLines = 0;
  for (;;) {
    const elapsed = Math.floor((ctx.io.now() - readAt) / 1000);
    const frame = renderLong(advance(snapshot, elapsed), ctx.paint);
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
}
