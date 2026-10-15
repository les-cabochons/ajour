# UI Tokens

The active design tokens live in `apps/web/src/styles.css`. Use these CSS variables and the Tailwind theme mappings instead of hard-coded values. Every value below is a decision: adding a new size, radius or color means changing this file, not adding an arbitrary value in a component.

## Fonts

- Sans: `Geist Variable` (`--font-sans`), self-hosted through fontsource, with a metric-matched `Geist Fallback` so the first paint does not shift.
- Mono: `Geist Mono Variable` (`--font-mono`), for every duration, total, count and id.
- There is no heading face. `--font-heading` maps to the sans so older `font-heading` classes still resolve.
- The body sets `font-variant-numeric: tabular-nums`, so digits line up everywhere.

## Type scale

Seven sizes, mapped to Tailwind's `text-*` utilities:

| Token           | Size | Utility     | Use                                              |
| --------------- | ---- | ----------- | ------------------------------------------------ |
| `--text-2xs`    | 11px | `text-2xs`  | Column labels, keyboard hints                    |
| `--text-xs`     | 12px | `text-xs`   | Secondary text, chips, values, descriptions      |
| `--text-sm`     | 13px | `text-sm`   | Body and every control                           |
| `--text-base`   | 14px | `text-base` | Page titles in the top bar, emphasized rows      |
| `--text-lg`     | 16px | `text-lg`   | Section headings on settings pages, figures      |
| `--text-xl`     | 20px | `text-xl`   | An object's title on a detail page, dock readout |
| `--text-figure` | 28px | `text-2xl`  | The one large number on a page                   |

Font weights: 400 for text, 500 for labels, buttons and row titles, 600 for page and object titles. Nothing heavier. Letter spacing stays `0`, except `tracking-tight` on the figure size.

## Controls

- `--control-height: 28px` for buttons, toggles, segmented controls and icon buttons.
- `--control-height-lg: 32px` for primary actions and every input, textarea and select.
- `--control-font-size` is the body size.
- Button sizes: `xs` 20px, `sm` 24px, default 28px, `lg` 32px; icon buttons `icon-xs` 20px, `icon-sm` 24px, `icon` 28px, `icon-lg` 32px.

## Radius

- `--radius-sm: 4px` for chips, inputs, menu items and the small button sizes.
- `--radius-md: 6px` (`--radius`, `--control-radius`) for buttons, rows, board cards and the dock.
- `--radius-lg: 8px` for popovers, dialogs, menus and the sidebar overlay.
- `--field-radius` is the input radius. Tailwind's `rounded-xl` and above all resolve to 8px.

## Color

Semantic variables, light and dark under `:root` and `:root.dark`:

- `--background`, `--foreground`, `--card`, `--popover`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--border`, `--input`, `--ring`
- `--primary`: the one accent, the logo's indigo. Primary buttons, focus rings, links, selected options and the returned pull request badge. Not the active nav row.
- `--success`: the running indicator, the dock's remaining-estimate bar and an active agent in the agent indicator. Nothing else.
- `--warning`: amber, with an icon, for days under target, over capacity, unmapped source states and an agent question.
- `--destructive`: destructive actions and failures only, including a failed agent session (a red ring in the agent indicator) and an agent error (a solid red dot).
- `--scrollbar-thumb`: the scrollbar thumb, on native scrollers and `ScrollArea`. The track is transparent. The sidebar backlog list shows the thumb only on hover or when focus is inside it.
- Workflow states and projects carry their own colors.

App-level aliases: `--surface-lowest`, `--surface-low` (the sidebar), `--surface`, `--surface-high`, `--surface-highest`, `--text`, `--text-secondary`, `--text-tertiary`, `--hover-bg`, `--highlight-bg`, `--field-bg`, `--field-border`, `--success-bg`, `--warning-bg`, `--danger-muted`, `--indigo-muted`.

The chrome is solid: `--nav-bg` and `--app-sidebar-bg` are opaque, with no blur.

## Shadows

`--shadow-popup` for popovers, menus, dialogs and the floating dock. `--shadow-drag` for drag previews. Nothing inside a scrolling list carries a shadow. `--shadow-sm`, `--shadow-md`, `--shadow-lg` and `--shadow-card` exist for older surfaces and are being retired.

## Motion

- `--duration: 120ms`, `--ease: cubic-bezier(0.4, 0, 0.2, 1)`.
- Overlays open and close with opacity and transform. Rows, hover states, nav items and chips change instantly.

## Layout

- `--app-sidebar-width` (272px comfortable, 200px compact, user-resizable), `--app-workspace-max-width: 1440px`.
- The top bar is 48px. Sidebar rows are 28px. Day-view rows are 40px. Backlog rows are 36px.
