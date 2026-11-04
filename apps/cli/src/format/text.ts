/**
 * Text measured the way a terminal shows it: by grapheme, in terminal
 * cells, with escape codes taking no room. Most graphemes take one cell;
 * East Asian wide characters and emoji take two.
 */

const ESCAPE_CODE = /\x1b\[[0-9;]*m/g;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The East Asian Wide and Fullwidth blocks, from Unicode's
 * EastAsianWidth.txt, as the ranges terminals draw two cells wide.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** The cells one grapheme takes: 2 for wide characters and emoji, else 1. */
function cellWidth(grapheme: string): number {
  if (
    EMOJI_PRESENTATION.test(grapheme) ||
    (PICTOGRAPH.test(grapheme) && grapheme.includes("\uFE0F"))
  ) {
    return 2;
  }
  const code = grapheme.codePointAt(0) ?? 0;
  return WIDE_RANGES.some(([low, high]) => code >= low && code <= high) ? 2 : 1;
}

export function displayWidth(text: string): number {
  return graphemes(text.replace(ESCAPE_CODE, "")).reduce(
    (total, grapheme) => total + cellWidth(grapheme),
    0,
  );
}

/**
 * Cuts `text` to at most `width` cells, ending with "…" when it had to cut.
 * Takes plain text: color is added after cutting.
 */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  let kept = "";
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const cells = cellWidth(grapheme);
    // Leave one cell for the ellipsis.
    if (used + cells > width - 1) break;
    kept += grapheme;
    used += cells;
  }
  return `${kept}…`;
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
