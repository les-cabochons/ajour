/**
 * The window widths that change the app layout, in CSS pixels. See
 * "Breakpoints" in agents/ux-spec.md.
 *
 * - Below DESKTOP_MIN_WIDTH: the narrow view, with no sidebars.
 * - From DESKTOP_MIN_WIDTH: the sidebar the user chose, beside the page.
 *
 * This module is the only place these numbers live. Scripts use the media
 * queries below, and `tailwind-breakpoints.ts` turns them into the `narrow`
 * and `desktop` variants for styles.css and class names.
 * Keep it free of imports: Tailwind loads it at build time.
 */
export const DESKTOP_MIN_WIDTH = 768;

/** Matches the narrow view. */
export const NARROW_VIEW_QUERY = `(width < ${DESKTOP_MIN_WIDTH}px)`;

/** Matches every desktop width. */
export const DESKTOP_QUERY = `(width >= ${DESKTOP_MIN_WIDTH}px)`;
