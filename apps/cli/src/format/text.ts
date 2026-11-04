/**
 * Text measured the way a terminal shows it: by grapheme, with escape codes
 * taking no room. Ajour's names and notes are Latin text with accents, so
 * every grapheme counts as one column.
 */

const ESCAPE_CODE = /\x1b\[[0-9;]*m/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

export function displayWidth(text: string): number {
  return graphemes(text.replace(ESCAPE_CODE, "")).length;
}

/**
 * Cuts `text` to `width` columns, ending with "…" when it had to cut. Takes
 * plain text: color is added after cutting.
 */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  const parts = graphemes(text);
  if (parts.length <= width) return text;
  return `${parts.slice(0, width - 1).join("")}…`;
}

export function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

export function padStart(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - displayWidth(text))) + text;
}

/** Minutes as "1:24", the way Ajour shows a duration. */
export function formatClock(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Seconds as "1:24:07", the way the timer dock shows the running entry. */
export function formatClockSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
