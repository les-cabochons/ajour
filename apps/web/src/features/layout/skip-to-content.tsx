import { FOCUS_ITEM_SELECTOR } from "@/lib/item-keys";

/** The page's `main` element, which Skip to content leads to. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * The first Tab stop of every page: it shows only while it has focus, and
 * Enter moves focus past the titlebar and the sidebar to the page's first row
 * or card, where the arrows and the item keys work. A page without rows
 * takes focus itself, so the next Tab reaches its first control. Before it,
 * the first time entry was about the 66th Tab stop (usability testing,
 * 2026-11-06).
 */
export function SkipToContent() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-[var(--shadow-popup)] ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-1/2 focus:z-[100] focus:-translate-x-1/2"
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById(MAIN_CONTENT_ID);
        const first = [
          ...(main?.querySelectorAll<HTMLElement>(FOCUS_ITEM_SELECTOR) ?? []),
        ].find((item) => item.tabIndex >= 0 && item.getClientRects().length);
        (first ?? main)?.focus();
      }}
    >
      Skip to content
    </a>
  );
}
