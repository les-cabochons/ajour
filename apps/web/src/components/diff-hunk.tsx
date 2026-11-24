import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FileDiffOptions, PatchDiffProps } from "@pierre/diffs/react";

/*
 * A thin wrapper over `@pierre/diffs`, which renders one hunk of a diff.
 * Each hunk mounts only when it nears the screen: until then it is an empty
 * box as tall as its lines, so a pull request with thousands of hunks
 * mounts nothing per line at rest. One observer watches every hunk, and the
 * library loads with the first hunk that mounts. Its lines are highlighted
 * in the library's worker pool (`diff-highlighter.ts`).
 */

const PatchDiff = lazy(async () => {
  const [{ PatchDiff, WorkerPoolContext }, { diffWorkerPool }] =
    await Promise.all([
      import("@pierre/diffs/react"),
      import("./diff-highlighter"),
    ]);
  const pool = diffWorkerPool();
  // Every hunk highlights in the shared worker pool.
  function HighlightedPatch(props: PatchDiffProps<undefined, undefined>) {
    return (
      <WorkerPoolContext.Provider value={pool}>
        <PatchDiff<undefined, undefined> {...props} />
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
): FileDiffOptions<undefined, undefined> {
  return {
    themeType,
    diffStyle: "unified",
    // Long lines wrap: the left edge of the code always shows.
    overflow: "wrap",
    disableFileHeader: true,
    hunkSeparators: "simple",
  };
}

export interface DiffHunkProps {
  /** The hunk alone as a unified diff of its file: its header, the `@@` line and its lines. */
  patch: string;
  /** Its rows, the lines after the `@@` line, for the height it holds before it mounts. */
  rows: number;
  /** Names the hunk for assistive technology, such as its file and lines. */
  label: string;
  theme: "light" | "dark";
}

/** One hunk of a diff, mounted when it nears the screen. */
export function DiffHunk({ patch, rows, label, theme }: DiffHunkProps) {
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || mounted) return;
    return observeOnce(element, () => setMounted(true));
  }, [mounted]);
  // Until it draws, the box is `--diff-line-height` tall per row (styles/deck.css).
  const rowCount = { "--diff-hunk-rows": rows } as CSSProperties;
  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      className="diff-hunk"
      data-drawn={mounted || undefined}
      style={rowCount}
    >
      {mounted ? (
        <Suspense fallback={<div className="diff-hunk-placeholder" />}>
          <PatchDiff patch={patch} options={options[theme]} />
        </Suspense>
      ) : null}
    </div>
  );
}
