# UI Rules

Ajour is an operational desktop/web app. Build interfaces for scanning, repeated daily entry, correction, and review. The model is Linear's density and structure with Vercel's restraint in color; see `agents/ui-tokens.md` for the values and `agents/ui-registry.md` for the shared patterns.

## Product Feel

- Quiet, utilitarian, and work-focused.
- Dense but organized: 13px body, 28px controls, 28px to 40px rows.
- One accent color, used for actions and selection, never for decoration.
- No decorative gradients, blobs, blur, or purely atmospheric visuals.
- Every page shares the same anatomy: the top bar carries the page title and actions, the content below is cardless.

## Layout

- The 48px top bar is the page header. List pages (Time, Backlog, Projects, Submit, Settings pages) put their title there with `PageHeader`. Detail pages (backlog item, project) put a small muted back arrow and section label there and keep the object's title in the content at 20px. Page actions sit after the title; the global entry controls and the day total stay at the right end.
- No second title band under the top bar. A page may have one toolbar row (filters, a week strip) at most.
- Cardless everywhere except dialogs, popovers and the timer dock. Stats are a `FigureRow`, object properties a `PropertyList`, lists are bordered rows with no outer frame, and sections are separated by a `SectionHeading` and space.
- Settings pages: sections 3rem apart under a 16px heading; each setting is a `SettingRow` (13px label, 12px description, control trailing) with no border or background between rows.
- Prefer full-width app surfaces with constrained inner content where needed.
- Keep fixed-format elements stable with explicit width, height, grid tracks, or aspect ratios. Rows, headers and controls have fixed heights, so a state change never causes layout work.
- Do not let hover states, badges, loading text, or dynamic labels resize the layout.
- Ensure mobile and desktop text never overlaps controls or adjacent content.

## Components

- Use existing `apps/web/src/components/ui` primitives before creating new primitives.
- `Chip` is the one metadata treatment: project, type, code, count, "Today". Two tones in practice, neutral and accent; warning, success and danger exist for state.
- `Value` is the one style for every duration, total, count and id: mono, tabular, 12px by default. The titlebar total, row durations and grid cells all use it. No pills around numbers.
- `Figure` and `FigureRow` replace stat cards. `PropertyList` replaces boxed side panels. `SectionHeading` heads every cardless section.
- `Empty` is two lines and at most one outline button, left-aligned in a list and centered on an empty page. No icon tiles.
- Use `apps/web/src/components/app-surface.tsx` for repeated product surfaces: `AppPanel` and `SettingRow` on settings pages, `MessagePanel` for warnings and errors, `ResultLine` for a finished action, `SurfaceCallout` for icon/title/body callouts.
- Use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx` for checkbox controls. Do not add new raw `type="checkbox"` controls in feature code.
- No native `<select>`, date, file or color inputs in feature code: use `Select`, the `Calendar` popover, a file button, and a color swatch popover.
- Feature pages should not directly reference `settings-panel` or `message-panel`; those classes are owned by the app-surface module.
- Use Remix icons already present in the app for icon buttons and navigation.
- Use icon-only buttons for common commands when the icon is familiar and an accessible label is provided.
- Every icon-only button shows a tooltip with its label and, when the action has a shortcut in `lib/shortcuts.ts`, its key. Use `TooltipButton` from `apps/web/src/components/tooltip-button.tsx`; its `render` prop takes a `Button`, a `Link` or a menu or popover trigger. Do not use `title=` on icon buttons.
- Every modal surface uses `Dialog`, `AlertDialog` or `Sheet` from `apps/web/src/components/ui`, and anchored surfaces use `Popover`. Do not build overlays by hand: no `role="dialog"` divs, fixed backdrops or `*-modal-overlay` classes.
- Use segmented controls, toggles, selects, tabs, popovers, dialogs, and menus according to their existing local patterns.

## Typography

- Use the seven sizes of the type scale through `text-2xs` to `text-2xl`. No arbitrary `text-[Npx]` values.
- Page titles are 14px semibold in the top bar. Object titles on detail pages are 20px semibold. Section headings are 12px medium muted on cardless pages and 16px semibold on settings pages.
- Reserve the 28px figure size for one number per page, such as the week total.
- Do not scale font size with viewport width.
- Keep letter spacing at `0`. No uppercase tracked labels; a column or section label is 11px or 12px medium in the secondary color.

## Color

- Use semantic CSS variables from `agents/ui-tokens.md`.
- The accent (`--primary`) marks primary buttons, focus, links and selected options. The active navigation row is a neutral tint.
- Green means running. Red means destructive or failed. Amber with an icon means warning. Success results are plain text with a check icon, never a green box.
- Workflow states and projects use their own colors as dots; nothing else is colored.

## Interaction

- Keep the fastest path for daily time entry visible and reachable.
- Make destructive actions explicit and reversible where practical.
- Connector sync and import actions must communicate side effects.
- Preserve user-entered values during validation errors.
- Settings save on change or on blur, only when the value changed, with the Undo toast where the UX spec gives one. No per-row Save buttons.
- Escape cancels every drag and puts the item back. Dropping an item where it started changes nothing. Reorder and cross-day drags get both from `lib/table-drag.ts`.
- Route loading shows `PageSkeleton` from `apps/web/src/components/page-skeleton.tsx`, the page layout in `Skeleton` blocks, after 150ms. Faster loads show nothing.

## Motion and performance

- No transitions on rows, hover states, nav items or chips. Transitions only on overlays opening and closing, at most 150ms, opacity and transform only. No shimmer.
- No `backdrop-filter` anywhere. No `box-shadow` inside a scrolling list.
- Rows mount their pickers, tooltips and menus on hover or focus, and sidebar rows stay memoized. A redesign may not add a component that mounts per row.
- Every shell, list or sidebar change is measured with `just ui-perf` before and after on the large workspace. The progress tracker's numbers are budgets; a regression over 10% blocks the change.

## Accessibility

- Every interactive icon needs an accessible name.
- Form errors should be near the field they describe.
- Keyboard focus must remain visible: a 2px accent ring.
- Dialogs and popovers should have predictable open, close, and submit behavior.
