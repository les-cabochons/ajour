# UI Registry

This registry captures reusable visual patterns already present in TimeTracker. Update it after meaningful UI additions.

## App Shell

- Sticky top navigation with compact height and glass-like background.
- Primary navigation uses icon + label entries for Time, Backlog, Projects, and Settings.
- Date and new-entry controls are available from the titlebar area for time workflows.

## Surfaces

- Use semantic surfaces from `styles.css`: `--surface-lowest`, `--surface-low`, `--surface`, `--surface-high`, and `--surface-highest`.
- Borders and muted backgrounds carry most hierarchy.
- Shadows are reserved for popovers, dialogs, drag states, and elevated overlays.
- App settings surfaces use `AppPanel` from `apps/web/src/components/app-surface.tsx`. Keep `settings-panel` class ownership inside that module.
- Status, empty, and warning messages use `MessagePanel` from `apps/web/src/components/app-surface.tsx`. Keep `message-panel` class ownership inside that module.
- Icon/title/body callouts use `SurfaceCallout` from `apps/web/src/components/app-surface.tsx`.

## Controls

- Compact controls use 13px sizing and tight radii.
- Popovers handle secondary choices such as calendar selection and compact creation flows.
- Searchable selects are preferred where project/task lists can grow.
- Time-entry project/task selection uses the shadcn command navigator in `features/projects/project-task-picker.tsx`: its default view lists projects only, selecting a project drills into active tasks, and typed task or mixed project/task terms return capped direct matches.
- Toggle groups and tabs are preferred for mutually exclusive local view modes.
- Checkboxes use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx`, backed by Base UI. Use its `indeterminate` prop for mixed selection state instead of mutating DOM refs.
- Connector settings fields are rendered through `apps/web/src/features/settings/connector-settings-ui.tsx`, so plugin-driven field styling stays consistent.
- Immediate on/off settings use `Switch` from `apps/web/src/components/ui/switch.tsx`; labels describe the action as Activate or Deactivate plus the capability name.
- Reorderable tables and navigation lists use `apps/web/src/lib/table-drag.ts` for consistent mouse/touch thresholds, cancellation, row movement, and drag-preview positioning.
- Saved time entries share `features/time/time-entry-fields.tsx`. Day hosts it inline; Week hosts it in a shadcn dialog. Entry actions use one dropdown/calendar surface for Duplicate, Duplicate to, and Move to.
- On mobile, backlog add and filter actions use a compact vertical pair of
  icon-only floating controls at the bottom right. Keep add as the lower primary
  action, open the filter menu upward, preserve safe-area spacing, and reserve
  scroll space so task rows are not obscured. The desktop backlog toolbar remains
  in the table header.

## Icons

- The app uses `@remixicon/react`.
- Common navigation and action icons include timer, backlog/list, folder/project, settings, plus, check, close, play, stop, and chevrons.
- Project icon persistence and normalization live in `apps/web/src/domain/projects/project-icon.ts`; React rendering and uploaded-image preparation live in `apps/web/src/lib/project-icons.tsx`.

## Typography

- Body text uses Raleway Variable.
- Heading moments use Noto Serif Variable where the existing design calls for more editorial weight.
- Dense app panels should keep headings small and direct.

## Empty And Loading States

- Use existing UI primitives for skeletons and empty states.
- Empty states should tell the user what is missing and provide the next action when there is one.
- Loading states should preserve layout dimensions.

### Plugin Catalog And Detail

File: `apps/web/src/features/settings/settings-connectors-page.tsx`
Last updated: 2026-08-07

| Property         | Class or token |
| ---------------- | -------------- |
| Background       | `AppPanel`, `--surface-high` on hover |
| Border           | `AppPanel` border, `border-border/70` for tabs and connection cards |
| Border radius    | `rounded-lg` for icons and connection cards; `--control-radius` for focus targets |
| Text — primary   | `text-sm font-semibold text-foreground` |
| Text — secondary | `text-sm leading-5 text-muted-foreground` |
| Spacing          | `p-4 gap-3` for catalog entries; `p-5 gap-5` for detail headers and forms |
| Hover state      | `hover:bg-[var(--surface-high)]` |
| Shadow           | none for catalog entries; connection cards use borders instead of elevation |
| Accent usage     | `Badge variant="secondary"` for active state; status colors only for errors |

**Pattern notes:**
Plugin settings use a compact system-level activation switch and refresh-policy
selector above a category tab bar and responsive two-column catalog. Catalog
entries merge normalized Ajour-index metadata with installed connector and
schema capabilities. The catalog calls non-connector extensions Plugins and
labels the project-data-shape capability Schema. An available remote connector shows Download;
only an installed plugin can be activated. Manual file installation remains a
separate action.

Opening an entry moves to a dedicated detail route with a back link,
identity-first header, status-driven primary action, capability band, capability
list, and information ledger before plugin-owned configuration. Cached catalog
artwork is optional: the identity mark supplies a consistent generated default
thumbnail, while the capability band supplies an equally sized operational-flow
fallback when no hero exists. Never fetch remote images from the renderer.
Mobile collapses the catalog to one column and preserves the detail hierarchy.

### Application Updates

File: `apps/web/src/features/settings/settings-general-page.tsx`
Last updated: 2026-08-06

The stable/nightly choice uses the shared compact toggle group inside an
`AppPanel`. Keep exactly one track selected, explain nightly risk beside the
control, and separate repository status with a single top border rather than a
nested card. Status text uses `aria-live`, preserves its layout while checking,
and shows the release action only when a newer matching release exists. Web-only
rendering keeps the preference available but identifies the desktop requirement.
Packaged Windows builds download the selected track in the background and use a
native restart confirmation only after the update is ready; the app never
restarts without the user's confirmation. Other platforms show truthful manual
update guidance while preserving the same release-track status and link.

### Weekly Time Overview

Files: `apps/web/src/features/time/weekly-time-view.tsx`, `apps/web/src/features/time/time-entry-fields.tsx`
Last updated: 2026-08-15

Day remains the default, timer-first time surface. A dedicated Week overview
action is available at desktop widths of 1024px and above; narrower layouts
fall back to Day. Week offers Ledger and Lanes through the shared toggle group,
with the preference persisted locally. Ledger aggregates project/task time by
day, shows project markers and daily totals, and reveals every contributing
entry in a tray attached to the same continuous ruled surface. Lanes use seven
equal-height headers, restrained weekend/today cues, and a project-color rail
on each entry card. Both styles share thresholded pointer dragging, explicit
weekday drop targets, Escape/pointer-cancel cleanup, and keyboard/double-click
editing. Running entries stay locked. Normal headers show logged totals only;
capacity target and utilization live in hover cards, with an optional compact
over-target warning.

The Week toolbar, table or lanes, totals, and detail tray form one full-width
desktop workspace rather than stacked cards. Return to Day is the leading
left-arrow action. The shared Day-inline/Week-dialog editor places an icon-only
entry-options trigger at the form's upper right. Duplicate to and Move to swap
that trigger's anchored Popover from actions to a Calendar with explicit
confirmation, avoiding a second modal or backdrop while preserving the Day
inline-editor outside-click boundary.

Capacity targets and the two independent warning switches live in General
Settings. Targets are Monday-first, default to eight hours on weekdays and zero
on weekends, and remain local user preferences. Submitting below the week target
adds a confirmation step only; the existing selection and submit command remain
unchanged.

### Project Import And Export

File: `apps/web/src/features/settings/settings-projects-page.tsx`
Last updated: 2026-08-06

The Projects settings workflow separates the schema selector from the Excel
format actions. `Ajour default` is always the first option and remains usable
without the plugin host. Discovered plugins add provider-specific schemas; the
selection persists in user preferences. Export and import copy identifies the
active schema and explains that the schema controls fields while Ajour owns
the file format.
