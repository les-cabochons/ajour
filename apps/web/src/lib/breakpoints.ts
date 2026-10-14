/**
 * The window widths that change the app layout, in CSS pixels. See
 * "Breakpoints" in agents/ux-spec.md.
 *
 * - Below DESKTOP_MIN_WIDTH: the narrow view, with no sidebars.
 * - From DESKTOP_MIN_WIDTH to APP_SIDEBAR_EXPANDED_MIN_WIDTH: the app sidebar
 *   hides and opens over the page, and the Projects list is a 48px rail.
 * - From APP_SIDEBAR_EXPANDED_MIN_WIDTH: the sidebar the user chose.
 *
 * This module is the only place these numbers live. Scripts use the media
 * queries below, and `tailwind-breakpoints.ts` turns them into the `narrow`,
 * `desktop` and `forced-rail` variants for styles.css and class names.
 * Keep it free of imports: Tailwind loads it at build time.
 */
export const DESKTOP_MIN_WIDTH = 768;

export const APP_SIDEBAR_EXPANDED_MIN_WIDTH = 1100;

/** Matches the narrow view. */
export const NARROW_VIEW_QUERY = `(width < ${DESKTOP_MIN_WIDTH}px)`;

/** Matches every desktop width. */
export const DESKTOP_QUERY = `(width >= ${DESKTOP_MIN_WIDTH}px)`;

/** Matches the desktop widths where the app sidebar hides and the Projects list is a rail. */
export const FORCED_RAIL_QUERY = `(${DESKTOP_MIN_WIDTH}px <= width < ${APP_SIDEBAR_EXPANDED_MIN_WIDTH}px)`;
