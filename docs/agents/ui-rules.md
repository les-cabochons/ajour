# UI Rules

Ajour is an operational desktop/web app. Build interfaces for scanning, repeated daily entry, correction, and review. The model is Linear's density and structure with Vercel's restraint in color; see `docs/agents/ui-tokens.md` for the values and `docs/agents/ui-registry.md` for the shared patterns.

## Product Feel

- Quiet, utilitarian, and work-focused.
- Dense but organized: 13px body, 28px controls, 28px to 40px rows. The sidebar's Comfortable backlog rows are the exception: 80px, three lines, like T3 Code's thread list. In the narrow view, Day rows and Backlog list rows are 52px with two lines.
- One accent color, used for actions and selection, never for decoration.
- No decorative gradients, blobs, blur, or purely atmospheric visuals. The one blur is the settings window's backdrop, which blurs the page behind it.
- Every page shares the same anatomy: the top bar carries the page title and actions, the content below is cardless. Pages that edit in place, the backlog item page and the project page, keep their actions next to the content they act on instead.

## Layout

- The 48px top bar is the page header. List pages (Time, Backlog, Commit, Settings pages) put their title there with `PageHeader`. The project list leaves the top bar title empty. Detail pages (backlog item, project) keep a small muted "Back to" link above the object's title in the content at 20px, and a breadcrumb in the top bar: the backlog item's project (or Backlog), then its title; Projects, then the project (council round 5). Page actions sit after the title; the global entry controls and the day total stay at the right end.
- No second title band under the top bar. A page may have one toolbar row (filters, a week strip) at most; Backlog shows its filter row only while filters are on, its other controls being in the top bar.
- Cardless everywhere except dialogs, popovers, the timer dock, the side cards of the backlog item page (properties, Subitems and Time entries) and the side cards of the project page (a managed project's Budget, and Properties). Stats are a `FigureRow`, object properties a `PropertyList`, lists are bordered rows with no outer frame, and sections are separated by a `SectionHeading` and space.
- Settings pages: sections 3rem apart under a 16px heading, within a 672px measure on pages of rows such as General, so a label and its control stay close (council round 6); each setting is a `SettingRow` (13px label, 12px description, control trailing) with no border or background between rows.
- Every page shares one left edge, `--page-gutter`. Detail pages fill their column from it, with the figures opening the main column so the side cards start level with them; prose keeps a reading measure (council round 7).
- Prefer full-width app surfaces with constrained inner content where needed.
- Keep fixed-format elements stable with explicit width, height, grid tracks, or aspect ratios. Rows, headers and controls have fixed heights, so a state change never causes layout work.
- Do not let hover states, badges, loading text, or dynamic labels resize the layout.
- Ensure mobile and desktop text never overlaps controls or adjacent content.

## Components

- Use existing `apps/web/src/components/ui` primitives before creating new primitives.
- `Chip` is the one metadata treatment: project, type, code, count, "Today". A list that repeats a project on every row, such as Backlog list rows, shows its dot and name as plain secondary text instead, so the list carries no shape per line. Two tones in practice, neutral and accent; warning, success and danger exist for state.
- `Value` is the one style for every duration, total, count and id: mono, tabular, 12px by default. The titlebar total, row durations and grid cells all use it. No pills around numbers.
- `Figure` and `FigureRow` replace stat cards. `PropertyList` replaces boxed side panels. `SectionHeading` heads every cardless section.
- `Empty` is two lines and at most one outline button, left-aligned in a list and centered on an empty page. No icon tiles.
- Use `apps/web/src/components/app-surface.tsx` for repeated product surfaces: `AppPanel` and `SettingRow` on settings pages, `MessagePanel` for warnings and errors, `ResultLine` for a finished action, `SurfaceCallout` for icon/title/body callouts.
- Use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx` for checkbox controls. Do not add new raw `type="checkbox"` controls in feature code.
- No native `<select>`, date, file or color inputs in feature code: use `Select`, the `Calendar` popover, a file button, and a color swatch popover.
- Feature pages should not directly reference `settings-panel` or `message-panel`; those classes are owned by the app-surface module.
- Use Remix icons already present in the app for icon buttons and navigation. Start and Continue use the filled play, as present as the filled Stop (council round 9).
- Use icon-only buttons for common commands when the icon is familiar and an accessible label is provided.
- Every icon-only button shows a tooltip with its label and, when the action has a shortcut in `lib/shortcuts.ts`, its key. Use `TooltipButton` from `apps/web/src/components/tooltip-button.tsx`; its `render` prop takes a `Button`, a `Link` or a menu or popover trigger. Do not use `title=` on icon buttons. Exceptions are the sidebar rows' hover actions (Start entry or Stop, Snooze…, Settle), so hovering down the list does not cover it, and the comment header's reaction and actions buttons, which use hover, pressed and open-menu tints without a tooltip.
- Every modal surface uses `Dialog`, `AlertDialog` or `Sheet` from `apps/web/src/components/ui`, and anchored surfaces use `Popover`. Do not build overlays by hand: no `role="dialog"` divs, fixed backdrops or `*-modal-overlay` classes.
- A `Dialog` is modal and centered in the window, over its backdrop, at every width. Never place one beside a row or in a corner: a form that must leave the page live is a side panel, and one tied to a control is a `Popover`.
- Use segmented controls, toggles, selects, tabs, popovers, dialogs, and menus according to their existing local patterns.

## Typography

- Use the seven sizes of the type scale through `text-2xs` to `text-2xl`. No arbitrary `text-[Npx]` values.
- Page titles are 14px semibold in the top bar. Object titles on detail pages are 20px semibold. Section headings are 12px medium muted on cardless pages and 16px semibold on settings pages.
- Reserve the 28px figure size for one number per page, such as the week total. That number opens its row of figures. A bar under figures always fills with the spent part, Completed or Budget used, whichever figure leads, so the same shape never means used on one page and left on another (council rounds 23 and 28).
- " · " joins a project and its task, or a row's parts, in rows, headers and the dock; " / " separates breadcrumb crumbs only, and a fraction reads "a of b" (council rounds 25 and 26). The wide Day view is the exception: its project and task sit in aligned 12px tracks, which scan better for many rows of one project (council rounds 8 and 30).
- Do not scale font size with viewport width.
- Keep letter spacing at `0`. No uppercase tracked labels; a column or section label is 11px or 12px medium in the secondary color.

## Color

- Use semantic CSS variables from `docs/agents/ui-tokens.md`.
- The accent (`--primary`) marks primary buttons, focus, links and selected options. The active navigation row is a neutral tint.
- Information lines, such as days still ahead on Commit, carry no icon; an icon there would read as a warning.
- Green means running. Red means destructive or failed. Amber with an icon means warning, or Urgent priority. A condition the user set up or chose, such as no connection or scheduled sync off, is a quiet secondary status line, not a warning. Change symbols are the one exception, see below. Success results are plain text with a check icon, never a green box.
- Change symbols on the Commit page carry their kind's color: Added green, Updated amber, Deleted red. Each kind also has its own icon shape.
- Workflow states and projects use their own colors as dots. A state's mark also carries its shape: an empty ring for the first open state, a pie that fills with the state's place among the open states (up to three quarters), and a whole disc when done, so state never reads by color alone (council round 14). The mark is 14px with a 9px disc, so a quarter and a half read apart (council round 22). Apart from them and the change symbols, nothing else is colored.

## Interaction

- Keep the fastest path for daily time entry visible and reachable.
- Make destructive actions explicit and reversible where practical.
- Backlog sync and import actions must communicate side effects.
- Preserve user-entered values during validation errors.
- Settings save on change or on blur, only when the value changed, with the Undo toast where the UX spec gives one. No per-row Save buttons.
- Escape cancels every drag and puts the item back. Dropping an item where it started changes nothing. Reorder and cross-day drags get both from `lib/table-drag.ts`.
- Enabled buttons, `role="button"` elements, links, switches and checkboxes show the pointer cursor, and disabled or `aria-disabled` ones show the default cursor. The base layer of `apps/web/src/styles.css` sets both, so components do not add `cursor-pointer`. Set a cursor only when it means something else, such as grabbing, resize or text.
- Rows that can be dragged to reorder keep the pointer cursor, because a click still opens or selects them. The grabbing cursor shows only while a drag runs.
- Route loading shows `PageSkeleton` from `apps/web/src/components/page-skeleton.tsx`, the page layout in `Skeleton` blocks, after 150ms. Faster loads show nothing.

## Motion and performance

- No transitions on rows, hover states, nav items or chips. Transitions only on overlays opening and closing, at most 150ms, opacity and transform only. No shimmer.
- No `backdrop-filter`, except the settings window's backdrop (`--overlay-blur`, off under `prefers-reduced-transparency`), which paints only while the window is open. No `box-shadow` inside a scrolling list.
- Rows mount their pickers, tooltips and menus on hover or focus, and sidebar rows stay memoized. A redesign may not add a component that mounts per row.
- Every shell, list or sidebar change is measured with `just ui-perf` before and after on the large workspace. The budgets are in the Performance section of `docs/agents/code-standards.md`; a regression over 10% blocks the change.

## Accessibility

- Every interactive icon needs an accessible name.
- Form errors should be near the field they describe.
- Keyboard focus must remain visible: a 2px accent ring.
- Dialogs and popovers should have predictable open, close, and submit behavior.
