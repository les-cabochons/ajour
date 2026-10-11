# UI Registry

This registry captures reusable visual patterns already present in Ajour. Update it after meaningful UI additions.

## App Shell

- Desktop uses a full-height application sidebar with a quiet translucent surface distinct from the workspace. Its top chrome strip reserves native macOS traffic lights; Time, Backlog, and Projects are grouped below it, while Settings is anchored at the bottom.
- The application sidebar is expanded (200px, logo, labels, and a collapse button next to the logo) or a 52px icon rail (icons with tooltips). The toggle button and Cmd+B (Ctrl+B outside macOS) switch between them. `lib/app-sidebar.ts` owns the state: it saves the choice per device in `localStorage` under `ajour.app-sidebar`, and below 1100px it forces the rail without changing the saved choice. While the rail is forced, the logo mark replaces the toggle and the shortcut does nothing. The shell exposes the state as `data-app-sidebar` on `.ajour-app-body`, and the rail CSS keys off it. Cmd+B lives in the shortcut registry, `lib/shortcuts.ts`, like every other key.
- "?" opens the shortcut overlay, `features/layout/shortcut-overlay.tsx`: a Dialog with a search field that lists every shortcut in the registry, grouped by scope ("Anywhere", "Time page", "Focused row or card"), with alternate keys after "or". Day rows and Week cards carry `data-entry-id` so C can continue the focused entry.
- Day rows, Days cards, Week Grid cells, backlog rows and task rows take keyboard focus. Each carries `data-focus-column` (the day index in the Week, "0" in lists) inside a `data-focus-scope` container, and its `onKeyDown` calls `handleItemKeyDown` from `lib/item-keys.ts`. Arrows move focus within the scope; the item keys in the registry (scope "item") run the action that the kind's `ActionKeys` map names, such as `TIME_ENTRY_ACTION_KEYS`; Alt+Up and Alt+Down call the row's reorder, which commits through `getSharedTableStepOrder` in `lib/table-drag.ts` and the same store command as a drag. ".", Shift+F10 and the context menu key open the "…" menu, or the right-click menu on Grid cells. The menus show each action's key from the same map, and the "…" menu gives focus back to its row on close. Grid cells keep their own Enter and digit editing.
- Cmd+K (Ctrl+K elsewhere) opens the command palette, `features/command-palette/command-palette.tsx`, and `openCommandPalette()` opens it from buttons such as the Projects list's Search. It lists the focused object's actions, search results across tasks, backlog items and projects, the registry's actions with their keys, and navigation. `command-palette-items.ts` builds and ranks the list. Focus attributes from `lib/focused-object.ts` name the focused object: `data-entry-id` with `data-running-entry`, `data-backlog-item-id`, `data-task-id` and `data-project-id`. Start entry and New entry… run in the palette; other object actions go to their page as `?action=<id>&target=<id>`, which the page runs through `useActionRequest` from `lib/action-request.ts`, so each action keeps one runner. While the Projects page is open, the palette sends every project and task command to it, including opening a project, the archive and Create project, so a task draft is saved first or blocks the command. Items show a disabled reason or hint on a second line, like the "…" menus.
- A pinned task shows its slot as a small key badge, `PinnedSlotBadge` in `features/projects/pinned-slot.tsx`, on its task row and in the project task picker. "Assign shortcut…" opens `PinnedSlotDialog` from the same file: ten slot buttons that name the task holding each slot, a number key picks a slot, and Clear shortcut frees it. The Projects page owns the picker, so the row menus and the palette's `?action=assign-shortcut` open the same one and write at once. The task panel's Shortcut field, `PinnedSlotField`, opens it too but only changes the draft, which Save writes.
- In wide windows Settings opens inside the shell. The application sidebar stays with Settings active, and `features/settings/settings-navigation.tsx` lists the settings pages in a 200px second column next to it, built on `CustomSidebar` like the Projects list. There is no Back control.
- Projects keeps the application sidebar and adds a permanently expanded 200px project sidebar aligned directly against its right edge, with no collapse control of its own; the project detail pane continues left-to-right from that rail rather than centering the split layout.
- Breakpoints live in `lib/breakpoints.ts` only: below 768px is the narrow view, 768px to 1099px forces the rail, and 1100px and up follows the saved choice. Scripts use its media queries or `useIsNarrowView` from `lib/use-narrow-view.ts`. Styles use the `narrow`, `desktop` and `forced-rail` Tailwind variants that `lib/tailwind-breakpoints.ts` builds from it, as `@variant narrow { ... }` in CSS or `narrow:` in class names. Do not write width media queries for layout.
- From 768px to 1099px the Projects sidebar is a 48px icon rail next to the 52px app rail; their links keep accessible names.
- The narrow view renders no rail and no sidebars. `features/layout/narrow-titlebar.tsx` puts a segmented Time and Backlog switcher at the start of the titlebar (the active section shows its label) and a Settings cog at the trailing edge. Settings opens on a full-width list of its pages, and `features/layout/narrow-navigation.ts` decides each page's back arrow, shown in a bar under the titlebar. The Settings list's Projects entry opens `/projects` as a full-width project list; project detail, the archive and project import and export (`/settings/projects`) lead back to it.
- Desktop structural surfaces consume the full area beside the application sidebar. Readable Time and Backlog content stays centered in a column capped at 1440px, while their color bands, table backgrounds, and row separators stretch to the workspace edges; individual pages may apply narrower readable inner columns.
- The daily Time view is a continuous page surface rather than an outer card: retain internal day and row separators, but do not draw a perimeter around the combined day strip and entry area. The day strip is a `day-viewer` size container: below 840px its padding tightens, and below 720px, as next to the entry side panel, it drops the seven days and the week total.
- Time and Backlog remove the generic page inset and meet the full workspace edges. Backlog fills the available workspace height and uses full-width internal header/row separators without a rounded outer card.
- The compact titlebar begins beside the application sidebar. Date and new-entry controls remain clear of the native Windows caption-control area.
- The app menu comes from `apps/desktop/electron/app-menu.cjs`. macOS shows it in the native menu bar. On Windows at 768px and up, `features/layout/app-menu-bar.tsx` draws the same menus at the start of the titlebar with the `components/ui/menubar.tsx` wrapper. Items run once their menu has closed and focus is back on the element the user was in, so Copy and Continue act on it. The narrow view and the web build show no menu bar.

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
- Creating and editing a time entry use one form, `features/time/time-entry-editor-form.tsx`: header with title, date, "…" and ×; Project / task, Note, Hours, Date (`time-entry-fields.tsx`); footer Cancel · Start (Switch while another entry runs, Continue on a saved entry, Stop on the running entry) · Save. Day and Week host it in `components/side-panel.tsx`, a panel docked on the right that keeps the page clickable and returns focus to the row or card on close. Clicking another entry saves a valid draft first; an invalid draft blocks the switch. In the narrow view, below 768px, and for New entry… on tasks and backlog items, `features/timer/time-entry-modal.tsx` hosts the same form in a dialog. In the narrow view that dialog spans the window, less an 8px margin on each side. The titlebar "+" and Running pill host it in `features/time/time-entry-editor-popover.tsx`, a popover anchored to them that ignores outside clicks. Entry actions come from `domain/actions/object-actions.ts` and render through `components/object-actions-menu.tsx` as a right-click menu and a "…" button.
- Delete entry, Discard running entry, Move to…, cross-day drag and Duplicate to… another day act at once and show an Undo toast for 8 seconds instead of a confirmation. `components/ui/toast.tsx` wraps the Base UI toast: `Toaster` is mounted once in `main.tsx`, bottom right, bottom center below 768px, at most three, newest on top. `showUndoToast` keeps one Undo toast open, and Cmd+Z (Ctrl+Z) presses it when focus is not in a text field. Time entry actions call it through `offerTimeEntryUndo` in `features/time/time-entry-actions.tsx`.
- Projects: "New project" in the project list header and Edit open `features/projects/project-form-dialog.tsx`, a standard `Dialog` that ignores outside clicks. Tasks open in `features/projects/project-task-editor-form.tsx` with the entry editor's Save and Escape rules, hosted in `components/side-panel.tsx`, or a full-width dialog in the narrow view. "New task" sits in the project header; "Import tasks…" is in the project header's "…" menu only.
- Projects, tasks and backlog items use the same pattern. Project rows in the project sidebar, the archived list and the project header; task rows; and backlog rows and the backlog item editor all show their kind's action set. Archive and Restore act at once. Backlog Delete asks for confirmation and states the subitem count.
- Creating and editing a backlog item use one form, `features/backlog/backlog-item-editor-form.tsx`: header with title, "…" and ×; Item, Priority (top-level items only), Status, Project, Task mapping, Note, the three estimates with "Reset to subitem total", and "Keep when missing from sync" for synced items; footer Cancel · Save. The Backlog page hosts it in `components/side-panel.tsx`, and in a dialog in the narrow view, below 768px. Save, Escape and switching follow the entry editor rules. The page header holds Active / Archived, the sort menu and New backlog item at every width.
- Logging time from a task or backlog item goes through New entry…, which opens `features/timer/time-entry-modal.tsx` prefilled with `initialValues`. The backlog has no inline hours field. Backlog rows keep the play button as the Start entry shortcut.
- The narrow view always shows the "…" on task and backlog rows. The 48px project rail hides it; right-click on the rail and the project header "…" cover projects there.
- On touch screens, a long press on any row or card with an action set opens the same menu as right-click. Base UI's `ContextMenu.Trigger` handles the press (500ms, cancelled by a 10px move); styles.css turns off text selection on those elements for coarse pointers so iOS does not start a selection on the same gesture.
- In the narrow view, backlog add and filter actions use a compact vertical pair of
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

| Property         | Class or token                                                                    |
| ---------------- | --------------------------------------------------------------------------------- |
| Background       | `AppPanel`, `--surface-high` on hover                                             |
| Border           | `AppPanel` border, `border-border/70` for tabs and connection cards               |
| Border radius    | `rounded-lg` for icons and connection cards; `--control-radius` for focus targets |
| Text — primary   | `text-sm font-semibold text-foreground`                                           |
| Text — secondary | `text-sm leading-5 text-muted-foreground`                                         |
| Spacing          | `p-4 gap-3` for catalog entries; `p-5 gap-5` for detail headers and forms         |
| Hover state      | `hover:bg-[var(--surface-high)]`                                                  |
| Shadow           | none for catalog entries; connection cards use borders instead of elevation       |
| Accent usage     | `Badge variant="secondary"` for active state; status colors only for errors       |

**Pattern notes:**
Plugin settings use a compact system-level activation switch and refresh-policy
selector above a category tab bar and responsive two-column catalog. Catalog
entries merge normalized Ajour-index metadata with installed connector and
schema capabilities. The category tabs are All, Connectors, and Schemas, and
the catalog labels non-connector plugins and the project-data-shape capability
Schema. An available remote connector shows Download;
only an installed plugin can be activated. Manual file installation remains a
separate action.

Opening an entry moves to a dedicated detail route with a back link,
identity-first header, status-driven primary action, capability band, capability
list, and information list before plugin-owned configuration. Cached catalog
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

Files: `apps/web/src/features/time/weekly-time-view.tsx`, `apps/web/src/features/time/week-grid.tsx`, `apps/web/src/features/time/week-grid-cell-panel.tsx`, `apps/web/src/features/time/time-entry-fields.tsx`
Last updated: 2026-10-11

Day remains the default, timer-first time surface. The date heading exposes a
compact anchored scope menu with `Day` and `Week` at desktop widths of 768px
and above. The narrow view has no scope menu. A Week link there (`?view=week`)
shows Day with a note that Week needs a wider window, and keeps `view=week`, so
widening the window shows Week.
Week offers Grid and Days through the shared toggle group,
with the preference persisted locally as `grid` or `days`. Grid aggregates project/task time by
day and shows project markers and daily totals. A click on a Grid cell opens it
in the side panel: a new entry for an empty cell, the entry of a one-entry cell
with "Add another entry for <day>", or the list of a cell with several entries
(`week-grid-cell-panel.tsx`). Double-click, Enter or a digit edits an empty or
one-entry cell in place; the typed-cell rules live in `domain/time/week-grid-cell.ts`.
A cell with several entries shows "3:30 ×2" and never edits in place. "+ Add row"
adds an empty row for the week, never saved on its own. Days use seven
equal-height headers, restrained weekend/today cues, and a project-color rail
on each entry card. Cards drag between days with thresholded pointer dragging,
explicit weekday drop targets, and Escape/pointer-cancel cleanup. A click or
Enter on a card opens it in the side panel. Running entries stay locked. Normal headers show logged totals only;
capacity target and utilization live in hover cards, with an optional compact
over-target warning.

The Week toolbar, grid or day columns, and totals form one full-width
desktop workspace rather than stacked cards. Return to Day is the leading
left-arrow action. Every time entry surface (Day rows, Days cards, Grid cells,
the Grid cell list and the entry form) exposes the same action set through a
right-click menu and a "…" button, which the narrow view always shows. Duplicate
to and Move to open a calendar dialog; Delete and Discard happen at once and show an Undo toast.
`features/time/time-entry-actions.tsx` runs the actions for every surface.

Capacity targets and the two independent warning switches live in General
Settings. Targets are Monday-first, default to eight hours on weekdays and zero
on weekends, and remain local user preferences.

### Submit Page

Files: `apps/web/src/features/time/submit-page.tsx`, `apps/web/src/features/time/submit-week-controls.tsx`

Route `/time/$date/submit` shows the week that holds `$date`. The Day and Week
headers open it with the shared `SubmitWeekButton` at every width, and the Week
header shows `WeekSubmittedBadge` once every entry is submitted. The page has a
summary (total against target, progress bar, warnings, result in place) and the
lines grouped by Day and task, Day or Task. Every value copies on click with an
always-visible icon; hours copy as decimals. Grouping, selection, summary and
status rules live in `domain/time/timesheet-submission.ts`. Submitting below the
week target asks for confirmation.

### Project Import And Export

File: `apps/web/src/features/settings/settings-projects-page.tsx`
Last updated: 2026-08-06

The Projects settings workflow separates the schema selector from the Excel
format actions. `Ajour default` is always the first option and remains usable
without the plugin host. Discovered plugins add provider-specific schemas; the
selection persists in user preferences. Export and import copy identifies the
active schema and explains that the schema controls fields while Ajour owns
the file format.
