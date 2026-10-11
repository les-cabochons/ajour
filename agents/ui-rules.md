# UI Rules

Ajour is an operational desktop/web app. Build interfaces for scanning, repeated daily entry, correction, and review.

## Product Feel

- Quiet, utilitarian, and work-focused.
- Dense but organized.
- Clear hierarchy without marketing-style hero sections.
- No decorative gradients, blobs, or purely atmospheric visuals.
- Avoid nested cards and page sections styled as floating cards.

## Layout

- Prefer full-width app surfaces with constrained inner content where needed.
- Use cards only for repeated items, dialogs, and genuinely framed tools.
- Keep fixed-format elements stable with explicit width, height, grid tracks, or aspect ratios.
- Do not let hover states, badges, loading text, or dynamic labels resize the layout.
- Ensure mobile and desktop text never overlaps controls or adjacent content.

## Components

- Use existing `apps/web/src/components/ui` primitives before creating new primitives.
- Use `apps/web/src/components/app-surface.tsx` for repeated product surfaces:
  - `AppPanel` for settings-style app panels.
  - `MessagePanel` for status, empty, and warning messages.
  - `SurfaceCallout` for icon/title/body callouts.
- Use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx` for checkbox controls. Do not add new raw `type="checkbox"` controls in feature code.
- Feature pages should not directly reference `settings-panel` or `message-panel`; those classes are owned by the app-surface module.
- Use Remix icons already present in the app for icon buttons and navigation.
- Use icon-only buttons for common commands when the icon is familiar and an accessible label is provided.
- Every icon-only button shows a tooltip with its label and, when the action has a shortcut in `lib/shortcuts.ts`, its key. Use `TooltipButton` from `apps/web/src/components/tooltip-button.tsx`; its `render` prop takes a `Button`, a `Link` or a menu or popover trigger. Do not use `title=` on icon buttons.
- Every modal surface uses `Dialog`, `AlertDialog` or `Sheet` from `apps/web/src/components/ui`, and anchored surfaces use `Popover`. Do not build overlays by hand: no `role="dialog"` divs, fixed backdrops or `*-modal-overlay` classes.
- Use segmented controls, toggles, selects, tabs, popovers, dialogs, and menus according to their existing local patterns.

## Typography

- Use compact headings inside panels, cards, sidebars, and toolbars.
- Reserve large display type for true page-level emphasis, which should be rare in this app.
- Do not scale font size with viewport width.
- Keep letter spacing at `0` unless an existing style already requires otherwise.

## Color

- Use semantic CSS variables from `agents/ui-tokens.md`.
- Avoid one-note palettes dominated by a single hue.
- Use status color only where it communicates state or risk.

## Interaction

- Keep the fastest path for daily time entry visible and reachable.
- Make destructive actions explicit and reversible where practical.
- Connector sync and import actions must communicate side effects.
- Preserve user-entered values during validation errors.
- Escape cancels every drag and puts the item back. Dropping an item where it started changes nothing. Reorder and cross-day drags get both from `lib/table-drag.ts`.
- Route loading shows `PageSkeleton` from `apps/web/src/components/page-skeleton.tsx`, the page layout in `Skeleton` blocks, after 150ms. Faster loads show nothing.

## Accessibility

- Every interactive icon needs an accessible name.
- Form errors should be near the field they describe.
- Keyboard focus must remain visible.
- Dialogs and popovers should have predictable open, close, and submit behavior.
