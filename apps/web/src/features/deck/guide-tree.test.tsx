// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import { reviewSections } from "@/domain/deck/guide";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { installDomShims } from "@/test-support/dom";
import {
  makeScrollable,
  scrollElement,
  sizeElements,
} from "@/test-support/virtual-geometry";
import { GuideTree } from "./guide-tree";

/*
 * The guide tree of a pull request with more sections than it mounts
 * (#790): only the ticks or titles in its view are mounted, and the one
 * holding the focus stays, however far the tree scrolls. The real
 * virtualizer runs on a 600px tree whose items are 20px high.
 */

beforeAll(installDomShims);

/** Files A–Z of 240 files, one hunk each. */
const SECTIONS = reviewSections(
  {
    headSha: "head",
    baseSha: "base",
    guide: null,
    files: Array.from({ length: 240 }, (_, index) => {
      const path = `src/f${String(index).padStart(3, "0")}.ts`;
      return {
        path,
        status: "modified" as const,
        binary: false,
        hunks: [
          {
            id: `${path}#0`,
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            patch: "",
          },
        ],
      };
    }),
  } satisfies DeckOpenedPullRequest,
  "files",
);

const Shell = ({ children }: { children: ReactNode }) => (
  <ShortcutProvider>
    <TooltipProvider>{children}</TooltipProvider>
  </ShortcutProvider>
);

let restoreSizes: (() => void) | undefined;
afterEach(() => {
  cleanup();
  restoreSizes?.();
  restoreSizes = undefined;
});

function renderTree(open: boolean) {
  restoreSizes = sizeElements([
    { selector: ".deck-guide-tree", width: 240, height: 600 },
    { selector: ".deck-guide-tree li", width: 240, height: 20 },
  ]);
  render(
    <Shell>
      <GuideTree
        sections={SECTIONS}
        viewed={new Set()}
        open={open}
        heading="Files"
        onToggle={() => {}}
        onReach={() => {}}
      />
    </Shell>,
  );
  const nav = screen.getByRole("navigation", { name: "Guide tree" });
  makeScrollable(nav);
  return nav;
}

it("keeps the focused tick mounted while the tree scrolls it away", () => {
  const nav = renderTree(false);
  const tick = screen.getByRole("button", {
    name: "src/f003.ts · 0 of 1 viewed",
  });
  act(() => tick.focus());

  scrollElement(nav, { top: 3_000 });

  expect(
    screen.queryByRole("button", { name: "src/f010.ts · 0 of 1 viewed" }),
  ).toBeNull();
  expect(tick.isConnected).toBe(true);
  expect(document.activeElement).toBe(tick);
});

it("keeps the focused title mounted while the open tree scrolls it away", () => {
  const nav = renderTree(true);
  const title = screen.getByText("src/f003.ts").closest("button")!;
  act(() => title.focus());

  scrollElement(nav, { top: 3_000 });

  expect(screen.queryByText("src/f010.ts")).toBeNull();
  expect(title.isConnected).toBe(true);
  expect(document.activeElement).toBe(title);
});
