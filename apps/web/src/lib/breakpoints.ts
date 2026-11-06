/**
 * The window widths that change the app layout, in CSS pixels. See
 * "Breakpoints" in docs/agents/ux-spec.md.
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

/**
 * Below this width the narrow view's bottom toggle no longer fits its four
 * sections side by side next to the agents dot, so it puts each name under
 * its icon.
 */
export const PHONE_MAX_WIDTH = 400;

/** Matches the narrow view. */
export const NARROW_VIEW_QUERY = `(width < ${DESKTOP_MIN_WIDTH}px)`;

/** Matches a phone in portrait, below 400px. */
export const PHONE_QUERY = `(width < ${PHONE_MAX_WIDTH}px)`;

/** Matches every desktop width. */
export const DESKTOP_QUERY = `(width >= ${DESKTOP_MIN_WIDTH}px)`;

/**
 * Matches a touch screen or the narrow view, where keyboard hints such as
 * the keys in menus only teach what a phone can't do.
 */
export const TOUCH_OR_NARROW_QUERY = `(pointer: coarse), ${NARROW_VIEW_QUERY}`;
