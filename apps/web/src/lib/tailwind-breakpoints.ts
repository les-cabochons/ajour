import plugin from "tailwindcss/plugin";
import {
  DESKTOP_QUERY,
  NARROW_VIEW_QUERY,
  TOUCH_OR_NARROW_QUERY,
} from "./breakpoints";

/**
 * Tailwind plugin loaded by styles.css. It declares the layout breakpoints
 * from `breakpoints.ts` as variants, so styles use `@variant narrow { ... }`
 * and class names use `narrow:` without restating the widths.
 * `touch-or-narrow:` hides keyboard hints on touch screens and phones.
 */
export default plugin(({ addVariant }) => {
  addVariant("narrow", `@media ${NARROW_VIEW_QUERY}`);
  addVariant("desktop", `@media ${DESKTOP_QUERY}`);
  addVariant("touch-or-narrow", `@media ${TOUCH_OR_NARROW_QUERY}`);
});
