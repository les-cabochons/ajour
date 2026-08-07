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
Last updated: 2026-08-02

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
Plugin settings use a category tab bar above a responsive two-column catalog.
Each entry keeps its icon, description, metadata, and activation switch visible
without nesting controls inside the configuration link. Opening an entry moves
to a dedicated detail route with a back link, compact identity header, activation
state, and the plugin-owned configuration forms. Mobile collapses the catalog to
one column without changing the card hierarchy or hiding activation.

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

### Project Import And Export

File: `apps/web/src/features/settings/settings-projects-page.tsx`
Last updated: 2026-08-06

The Projects settings workflow separates the data-shape selector from the Excel
format actions. `Ajour default` is always the first option and remains usable
without the plugin host. Discovered shape plugins add provider-specific options;
the selection persists in user preferences. Export and import copy identifies
the active shape and explains that the shape controls fields while Ajour owns
the file format.
