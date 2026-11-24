import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { RiAddLine as Plus } from "@remixicon/react";
import type {
  DiffLineAnnotation,
  FileDiffOptions,
  PatchDiffProps,
  SelectedLineRange,
} from "@pierre/diffs/react";

/*
 * A thin wrapper over `@pierre/diffs`, which renders one hunk of a diff.
 * Each hunk mounts only when it nears the screen: until then it is an empty
 * box as tall as its lines, so a pull request with thousands of hunks
 * mounts nothing per line at rest. One observer watches every hunk, and the
 * library loads with the first hunk that mounts. Its lines are highlighted
 * in the library's worker pool (`diff-highlighter.ts`).
 *
 * A hunk that takes comments has two ways in, one element each: the "+"
 * the library moves beside the line under the pointer, and, for the
 * keyboard, one button per hunk, "Comment on line N", whose arrow keys move
 * it from line to line and whose Enter opens the composer there.
 */

/** What a line annotation carries: the key of what it shows. */
interface AnnotationData {
  key: string;
}

const PatchDiff = lazy(async () => {
  const [{ PatchDiff, WorkerPoolContext }, { diffWorkerPool }] =
    await Promise.all([
      import("@pierre/diffs/react"),
      import("./diff-highlighter"),
    ]);
  const pool = diffWorkerPool();
  // Every hunk highlights in the shared worker pool.
  function HighlightedPatch(props: PatchDiffProps<AnnotationData, undefined>) {
    return (
      <WorkerPoolContext.Provider value={pool}>
        <PatchDiff<AnnotationData, undefined> {...props} />
      </WorkerPoolContext.Provider>
    );
  }
  return { default: HighlightedPatch };
});

/** How far below or above the screen a hunk mounts, so scrolling finds it drawn. */
const MOUNT_MARGIN = "1200px 0px";

const mounts = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | undefined;

/** Calls `mount` once `element` nears the screen. Never without IntersectionObserver. */
function observeOnce(element: Element, mount: () => void) {
  if (typeof IntersectionObserver === "undefined") return () => {};
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        mounts.get(entry.target)?.();
        mounts.delete(entry.target);
      }
    },
    { rootMargin: MOUNT_MARGIN },
  );
  mounts.set(element, mount);
  observer.observe(element);
  return () => {
    mounts.delete(element);
    observer?.unobserve(element);
  };
}

const options = {
  light: diffOptions("light"),
  dark: diffOptions("dark"),
};

function diffOptions(
  themeType: "light" | "dark",
): FileDiffOptions<AnnotationData, undefined> {
  return {
    themeType,
    diffStyle: "unified",
    // Long lines wrap: the left edge of the code always shows.
    overflow: "wrap",
    disableFileHeader: true,
    hunkSeparators: "simple",
  };
}

/** Which side of the unified diff a line is on: the head's lines are additions, the base's deletions. */
export type DiffLineSide = "additions" | "deletions";

/** Something shown after a line of the hunk, such as a review thread. */
export interface DiffHunkAnnotation {
  key: string;
  side: DiffLineSide;
  line: number;
}

export interface DiffHunkProps {
  /** The hunk alone as a unified diff of its file: its header, the `@@` line and its lines. */
  patch: string;
  /** Its rows, the lines after the `@@` line, for the height it holds before it mounts. */
  rows: number;
  /** Names the hunk for assistive technology, such as its file and lines. */
  label: string;
  theme: "light" | "dark";
  /** The hunk's id, as `data-hunk`, so a page can find its box. */
  hunkId?: string;
  /** What shows after each annotated line, drawn by `renderAnnotation`. */
  annotations?: readonly DiffHunkAnnotation[];
  renderAnnotation?: (key: string) => ReactNode;
  /** Lines to highlight, such as the line of a hovered comment. */
  highlight?: { side: DiffLineSide; start: number; end: number } | null;
  /**
   * Shows a "+" beside the line under the pointer, which comments on that
   * line, or on the lines dragged over from it, and a keyboard button on
   * one line at a time. One of each per hunk, moved from line to line:
   * nothing is mounted per line.
   */
  onAddComment?: (lines: DiffLineRange) => void;
}

/** Lines of one side of the hunk, from `start` to `end`. */
export interface DiffLineRange {
  side: DiffLineSide;
  start: number;
  end: number;
}

/** A line of the hunk as a comment names it: a removed line by the base's number, any other by the head's. */
interface HunkLine {
  side: DiffLineSide;
  line: number;
}

/** The hunk's lines in row order, or only its first with `first`. */
export function hunkLines(patch: string, first = false): HunkLine[] {
  const rows = patch.split("\n");
  const at = rows.findIndex((row) => row.startsWith("@@"));
  const [, oldStart = 1, newStart = 1] =
    /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(rows[at] ?? "")?.map(Number) ?? [];
  let base = oldStart;
  let head = newStart;
  const lines: HunkLine[] = [];
  for (const row of rows.slice(at + 1)) {
    if (row.startsWith("-")) lines.push({ side: "deletions", line: base++ });
    else if (row.startsWith("+") || row.startsWith(" ")) {
      lines.push({ side: "additions", line: head++ });
      if (row.startsWith(" ")) base += 1;
    } else continue;
    if (first) break;
  }
  return lines;
}

/**
 * Names the library's "+", an icon button it builds in the hunk's shadow
 * root and moves beside the line under the pointer, and leaves it out of
 * the tab order: the keyboard has the hunk's own button. The library
 * takes no name for it, and a "+" of the app's own would replace the drag
 * it starts. True once named, as the library reuses the button.
 */
function nameGutterButton(hunk: HTMLElement) {
  const button = hunk
    .querySelector("diffs-container")
    ?.shadowRoot?.querySelector("[data-utility-button]");
  if (!button) return false;
  button.setAttribute("aria-label", "Comment on this line");
  button.setAttribute("tabindex", "-1");
  return true;
}

const lineName = ({ side, line }: HunkLine) =>
  side === "deletions"
    ? `Comment on removed line ${line}`
    : `Comment on line ${line}`;

/**
 * The hunk's keyboard way to comment: one button, hidden until it has
 * focus, on one line at a time. Up and Down, Home and End move it, and
 * the hunk highlights its line; Enter or Space opens the composer there.
 * The hunk's lines are read on its first key, not at rest.
 */
function LineCommentKey({
  patch,
  onAddComment,
  onLine,
}: {
  patch: string;
  onAddComment: (lines: DiffLineRange) => void;
  onLine: (line: HunkLine | null) => void;
}) {
  const lines = useRef<HunkLine[] | undefined>(undefined);
  const [current, setCurrent] = useState<HunkLine | undefined>();
  const [focused, setFocused] = useState(false);
  const shown = current ?? hunkLines(patch, true)[0];
  if (!shown) return null;
  const name = lineName(shown);
  function move(event: KeyboardEvent<HTMLButtonElement>) {
    const steps: Record<string, (index: number, last: number) => number> = {
      ArrowDown: (index, last) => Math.min(index + 1, last),
      ArrowUp: (index) => Math.max(index - 1, 0),
      Home: () => 0,
      End: (_, last) => last,
    };
    const step = steps[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    lines.current ??= hunkLines(patch);
    const all = lines.current;
    const index = all.findIndex(
      (line) => line.side === shown!.side && line.line === shown!.line,
    );
    const next = all[step(Math.max(index, 0), all.length - 1)];
    if (!next) return;
    setCurrent(next);
    onLine(next);
  }
  return (
    <>
      <button
        type="button"
        className="diff-line-key"
        aria-keyshortcuts="ArrowUp ArrowDown Home End"
        onFocus={() => {
          setFocused(true);
          onLine(shown);
        }}
        onBlur={() => {
          setFocused(false);
          onLine(null);
        }}
        onKeyDown={move}
        onClick={() =>
          onAddComment({ side: shown.side, start: shown.line, end: shown.line })
        }
      >
        <Plus aria-hidden="true" />
        {name}
        <span className="diff-line-key-hint" aria-hidden="true">
          ↑↓
        </span>
      </button>
      {/* The line it moved to, read out while it has focus. */}
      {focused ? (
        <span className="sr-only" aria-live="polite">
          {current ? name : ""}
        </span>
      ) : null}
    </>
  );
}

/** One hunk of a diff, mounted when it nears the screen. */
export const DiffHunk = memo(function DiffHunk({
  patch,
  rows,
  label,
  theme,
  hunkId,
  annotations,
  renderAnnotation,
  highlight,
  onAddComment,
}: DiffHunkProps) {
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  // The line the keyboard's button is on, and whether it has been: the
  // selection stays the page's once the keyboard took it.
  const [keyLine, setKeyLine] = useState<HunkLine | null>(null);
  const [keyed, setKeyed] = useState(false);
  // Whether the library's "+" has its name: it keeps one button per hunk.
  const named = useRef(false);
  useEffect(() => {
    const element = box.current;
    if (!element || mounted) return;
    return observeOnce(element, () => setMounted(true));
  }, [mounted]);
  const lineAnnotations = useMemo(
    () =>
      annotations?.map((annotation): DiffLineAnnotation<AnnotationData> => ({
        side: annotation.side,
        lineNumber: annotation.line,
        metadata: { key: annotation.key },
      })),
    [annotations],
  );
  const selectedLines = useMemo((): SelectedLineRange | null | undefined => {
    const lines = keyLine
      ? { side: keyLine.side, start: keyLine.line, end: keyLine.line }
      : highlight;
    // A hunk without annotations leaves the selection to the library.
    if (!annotations?.length && !keyed) return undefined;
    if (!lines) return null;
    return {
      start: lines.start,
      end: lines.end,
      side: lines.side,
      endSide: lines.side,
    };
  }, [annotations, highlight, keyLine, keyed]);
  const hunkOptions = useMemo(
    (): FileDiffOptions<AnnotationData, undefined> =>
      onAddComment
        ? {
            ...options[theme],
            enableGutterUtility: true,
            onGutterUtilityClick: (range) => {
              const side = range.endSide ?? range.side ?? "additions";
              // Lines from both sides keep only the line the drag ended on.
              if ((range.side ?? side) !== side)
                onAddComment({ side, start: range.end, end: range.end });
              else
                onAddComment({
                  side,
                  start: Math.min(range.start, range.end),
                  end: Math.max(range.start, range.end),
                });
            },
          }
        : options[theme],
    [onAddComment, theme],
  );
  // Until it draws, the box is `--diff-line-height` tall per row (styles/deck.css).
  const rowCount = { "--diff-hunk-rows": rows } as CSSProperties;
  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      className="diff-hunk"
      data-hunk={hunkId}
      data-drawn={mounted || undefined}
      style={rowCount}
      onPointerMove={
        onAddComment
          ? (event) => {
              if (!named.current)
                named.current = nameGutterButton(event.currentTarget);
            }
          : undefined
      }
    >
      {mounted && onAddComment ? (
        <LineCommentKey
          patch={patch}
          onAddComment={onAddComment}
          onLine={(line) => {
            setKeyLine(line);
            if (line) setKeyed(true);
          }}
        />
      ) : null}
      {mounted ? (
        <Suspense fallback={<div className="diff-hunk-placeholder" />}>
          <PatchDiff
            patch={patch}
            options={hunkOptions}
            lineAnnotations={lineAnnotations}
            selectedLines={selectedLines}
            renderAnnotation={
              renderAnnotation
                ? (annotation) => renderAnnotation(annotation.metadata.key)
                : undefined
            }
          />
        </Suspense>
      ) : null}
    </div>
  );
});
