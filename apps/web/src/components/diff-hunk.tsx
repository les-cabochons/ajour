import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { FileDiffOptions } from "@pierre/diffs/react";

/*
 * A thin wrapper over `@pierre/diffs`, which renders one hunk of a diff.
 * Each hunk mounts only when it nears the screen: until then it is an empty
 * box as tall as its lines, so a pull request with thousands of hunks
 * mounts nothing per line at rest. One observer watches every hunk, and the
 * library loads with the first hunk that mounts.
 */

const PatchDiff = lazy(async () => {
  const { PatchDiff } = await import("@pierre/diffs/react");
  return { default: PatchDiff<undefined, undefined> };
});

/** A rendered line's height (`--diffs-line-height` in styles/deck.css), for the box a hunk holds before it mounts. */
const LINE_HEIGHT_PX = 20;
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
  /** The hunk as a unified diff of its file: `---`, `+++`, the `@@` line and its lines. */
  patch: string;
  /** Its line count, for the height it holds before it mounts. */
  lineCount: number;
  /** Names the hunk for assistive technology, such as its file and lines. */
  label: string;
  theme: "light" | "dark";
}

/** One hunk of a diff, mounted when it nears the screen. */
export function DiffHunk({ patch, lineCount, label, theme }: DiffHunkProps) {
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || mounted) return;
    return observeOnce(element, () => setMounted(true));
  }, [mounted]);
  const placeholder = { height: lineCount * LINE_HEIGHT_PX };
  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      className="diff-hunk"
      style={mounted ? undefined : placeholder}
    >
      {mounted ? (
        <Suspense fallback={<div style={placeholder} />}>
          <PatchDiff patch={patch} options={options[theme]} />
        </Suspense>
      ) : null}
    </div>
  );
}
