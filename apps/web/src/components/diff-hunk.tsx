import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  DiffLineAnnotation,
  FileDiffOptions,
  SelectedLineRange,
} from "@pierre/diffs/react";

/*
 * A thin wrapper over `@pierre/diffs`, which renders one hunk of a diff.
 * Each hunk mounts only when it nears the screen: until then it is an empty
 * box as tall as its lines, so a pull request with thousands of hunks
 * mounts nothing per line at rest. One observer watches every hunk, and the
 * library loads with the first hunk that mounts.
 */

/** What a line annotation carries: the key of what it shows. */
interface AnnotationData {
  key: string;
}

const PatchDiff = lazy(async () => {
  const { PatchDiff } = await import("@pierre/diffs/react");
  return { default: PatchDiff<AnnotationData, undefined> };
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
   * line, or on the lines dragged over from it. One button per hunk, moved
   * as the pointer moves: nothing is mounted per line.
   */
  onAddComment?: (lines: DiffLineRange) => void;
}

/** Lines of one side of the hunk, from `start` to `end`. */
export interface DiffLineRange {
  side: DiffLineSide;
  start: number;
  end: number;
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
    // A hunk without annotations leaves the selection to the library.
    if (!annotations?.length) return undefined;
    if (!highlight) return null;
    return {
      start: highlight.start,
      end: highlight.end,
      side: highlight.side,
      endSide: highlight.side,
    };
  }, [annotations, highlight]);
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
    >
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
