import plugin from "tailwindcss/plugin";
import {
  DESKTOP_QUERY,
  FORCED_RAIL_QUERY,
  NARROW_VIEW_QUERY,
} from "./breakpoints";

/**
 * Tailwind plugin loaded by styles.css. It declares the layout breakpoints
 * from `breakpoints.ts` as variants, so styles use `@variant narrow { ... }`
 * and class names use `narrow:` without restating the widths.
 */
export default plugin(({ addVariant }) => {
  addVariant("narrow", `@media ${NARROW_VIEW_QUERY}`);
  addVariant("desktop", `@media ${DESKTOP_QUERY}`);
  addVariant("forced-rail", `@media ${FORCED_RAIL_QUERY}`);
});
