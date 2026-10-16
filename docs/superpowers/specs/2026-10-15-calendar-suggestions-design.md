# Calendar suggestions through a calendar plugin

- Date: 2026-10-15
- Status: Implemented, slices 1 to 5 (#179 to #183). Tracking issue #178. Open: a real private feed from each provider.
- Scope: the `calendar` plugin capability, the calendar contract, suggestions in the Time view, remembered meetings, the ICS plugin
- Decisions: [ADR 0005](../../../agents/adr/0005-calendar-events-are-fetched-per-week-and-never-stored.md)
- Terms: `agents/GLOSSARY.md`, sections "Time entries" and "Extensions"

## Summary

Ajour shows the user's calendar events next to each day of the Time view and turns the ones they pick into time entries. Events arrive through a plugin with the new **calendar** capability, so a user who never installs one never sees a suggestion. The first plugin reads a private ICS address, which Google Calendar, Outlook and Exchange all publish, so one plugin covers the three providers without OAuth. Google and Microsoft API plugins come later, once the host has an OAuth flow.

A suggestion is not an entry. It becomes one only when the user adds it. Ajour remembers the project and task of a recurring meeting after the first time, so the second occurrence is one click. Ajour never stores the events themselves: it fetches the week on demand and keeps only the user's decisions.

## Goals

- Show the week's events in the Time view with the time span, the title and the duration, per day.
- Add an event as an entry with one click once its project and task are known, and with a project picker the first time.
- Add several events at once for a week.
- Keep calendar data local and minimal. Store no event beyond what the user chose to put in an entry.
- Keep everything invisible when no calendar plugin is installed and enabled.

## Non-goals

- Writing to the calendar. The capability is read-only.
- Adding entries without the user pressing Add. A remembered meeting fills the form, it does not submit it.
- Attendees, descriptions, locations, join links or free and busy views. None reach the host.
- OAuth. This spec takes a secret address. An OAuth track for the Google and Microsoft API plugins is a separate spec.
- Exposing suggestions to agents over MCP. An entry added from a suggestion is an ordinary entry and travels like one (ADR 0004).
- Plugin-provided UI. Ajour renders every screen (ADR 0003).

## Decisions

- **A capability, not a connector.** The connector capability syncs backlog items and estimates. A calendar event is a time-bounded fact that suggests a time entry, so it gets its own capability, `calendar`, next to `connector`, `codeHost`, `agentTask` and `projectProperties`. One plugin may declare several. The plugin API stays at 3: like agent tasks and project properties, the capability is additive, and the host requires an exact version match, so a bump would disable every published plugin.
- **Stateless week fetches.** The plugin answers one question: which events fall in this date range. No incremental sync, no tokens to keep. A week is small enough to fetch whole, as the code host does for pull requests.
- **Nothing persisted but decisions.** Fetched events live in renderer memory with a short TTL. Local state keeps the user's decisions per event occurrence and the remembered meetings per series (ADR 0005).
- **"Rule" is a code word.** The domain and the docs say _event rule_. The UI says _remembered meeting_ and _hidden meeting_. It is the same object as a repository rule for pull requests, applied to a meeting series.
- **ICS first.** The first plugin, `les-cabochons/ajc-ics`, takes a private ICS address. It is a plugin like any other, so the Google and Microsoft API plugins replace nothing when they arrive.

## Plugin capability

The manifest declares `capabilities.calendar: {}`. A plugin with it runs code, so `pluginRunsCode` includes it, and it needs an entrypoint and connection fields like a connector or a code host. The catalog capability enum gains `calendar`, and the desktop plugin index validates it. Calendar is a switchable capability: a plugin that also declares a connector or a code host shows a **Calendar events** switch on its page, and turning it off refuses calendar calls and cancels running ones.

Settings > Plugins shows a calendar plugin and its connections through the existing connection form, rendered from the declared fields. A user can have several connections, for example work Outlook and personal Google, and each suggestion carries its connection label when there is more than one.

### Contract

`packages/shared/calendar.ts`, built like `code-host.ts`: provider-neutral facts, an operations map keyed by the function the plugin exports, request and result schemas, bounded payloads.

Operations:

- `validateConnection`: shared with every code-running capability.
- `listCalendarEvents`: request `{ from, to, timeZone }`, with `from` and `to` as local dates, inclusive, at most 62 days apart, and `timeZone` an IANA name the plugin uses for floating times. Result `{ events: CalendarEventFacts[] }`, at most 1000 events.

A calendar event fact:

| Field         | Type                                                          | Notes                                                                  |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `eventId`     | string                                                        | The provider's id of the event, the UID in ICS.                        |
| `seriesId`    | string, optional                                              | Shared by every occurrence of a recurring event. Absent for a one-off. |
| `startsAt`    | Unix ms                                                       |                                                                        |
| `endsAt`      | Unix ms                                                       | After `startsAt`.                                                      |
| `allDay`      | boolean                                                       |                                                                        |
| `title`       | string, at most 200 chars                                     | Empty when the provider hides it; Ajour shows "Busy".                  |
| `status`      | `confirmed`, `tentative`, `cancelled`                         |                                                                        |
| `response`    | `accepted`, `tentative`, `declined`, `needsAction`, `unknown` | The user's own reply, when the plugin can tell.                        |
| `busy`        | boolean                                                       | False for an event marked free, such as a reminder.                    |
| `isOrganizer` | boolean, optional                                             |                                                                        |

Nothing else. The **occurrence key** is `eventId` plus `startsAt`; it identifies one occurrence across fetches. Cancelled occurrences are returned so Ajour can hide an already seen one, and are never suggested.

### Host

The plugin host gets `runCalendarOperation`, an `assertCapability` for `calendar`, and the API a `POST /api/calendars/:pluginId/connections/:connectionId/:operation` route, mirroring the code host route. Workers stay stateless and terminate after each call. A call records the connection's last success or error like a sync. The route replaces the connection's secret values in a plugin's error message with `[secret]` before it stores or returns it. It logs one `calendar.operation` wide event per call: operation, plugin, connection, range in days, event count, duration, outcome. Never the address, never a title, never the error text.

## Suggestions

### Domain

`domain/time/calendar-suggestions.ts` owns the deterministic rules, with no browser APIs:

- Turn fetched facts into suggestions per local date, using the machine time zone like the rest of the Time domain. An event crossing midnight counts on its start day with its full duration. An event longer than 24 hours counts as all-day.
- Hide what the filters exclude: all-day events, declined events, events marked free, cancelled events, events the user has not answered, events shorter than a minimum. Each filter is a setting; cancelled is always hidden.
- Hide occurrences with a decision: dismissed, or added while the entry still exists. An added occurrence whose entry is gone is suggested again, so deleting the entry is enough to start over. Undo of the delete hides it again through the same selector.
- Hide occurrences of a hidden meeting.
- Resolve the project and task of each suggestion from the event rule of its series, when one exists. A rule whose project or task was deleted or archived counts as missing and the suggestion asks again.
- Accept: build the entry through `createTimesheetEntry` with the event's local date, its duration rounded to the minute, its title as the note, and the chosen project and task. Record the decision with the entry id. Optionally write or replace the series' rule.
- Accept several at once: the same, for every chosen occurrence that has a project, in one state change with one Undo.
- Dismiss one occurrence, hide a series, forget a remembered meeting.

Undo covers add, add several, dismiss and hide, through `local-state-undo.ts`.

### Records

In `local-state.ts`, with defaults for historical state:

- `calendarDecisions`: `{ _id, pluginId, connectionId, occurrenceKey, localDate, decision: "added" | "dismissed", entryId?, decidedAt }`. No title, no time span. Retained 90 days past `localDate`.
- `calendarEventRules`: `{ _id, pluginId, connectionId, seriesId, label, action: "assign" | "hide", projectId?, taskId?, createdAt }`. `label` is the title when the rule was made, so Settings can show it. It is the only calendar text Ajour persists outside entries.
- Settings: the filters above and the refresh interval.

### Runtime

`lib/calendar-suggestions.ts` fetches the visible week per enabled calendar connection, keeps the result in memory for 10 minutes, exposes a `useSyncExternalStore` hook like `code-host-connections.ts`, and refreshes when the user opens another week, presses Refresh, or the interval elapses while the window is visible. A failed fetch shows the error inline and keeps the last result. Suggestions need the local API and the network, like pull requests; without them the surfaces show nothing.

## What the user sees

Everything below exists only while a calendar plugin is installed, enabled and has a connection.

### Days layout

Under each day's Add button, a "From calendar" label and one dashed card per suggestion: the time span, the title, and the project and task when remembered, or a "Choose project…" picker. Hover or focus shows an Add hint. A card with a project adds on click, Enter and Space. On a card without one, those open the picker.

Choosing a project in a picker adds the entry at once. For a recurring meeting it also remembers the project and task. The first version of this spec opened the side panel with a **Remember this meeting** checkbox instead; the inline picker does the same in one step, and Forget this meeting, Settings > Calendar and the Undo toast take a remembered meeting back.

### Day view

A "From your calendar" section under the day's rows, with a count and Refresh. Each 40px dashed row: time span, title, an inline project and task picker seeded from the remembered meeting, duration, Add, a dismiss button and the "…" menu. Enter adds, Delete dismisses (`agents/ux-spec.md`). A footer line says how many events the filters hid, with "Show hidden" for that day. A failed fetch shows its message, and the last events stay.

### Side panel

A **Calendar** button in the top bar of the Time view, with the count of open suggestions for the week, opens the side panel. The panel lists the week's suggestions grouped by day, each with a checkbox, the time span, the title, the project and task or "No project yet", and the duration. Events with a project start checked. The footer's primary button reads "Add 4 entries · 2:30" and adds every checked suggestion in one action with one Undo toast. An unchecked event without a project is left alone. A suggestion without a project gets the same picker as in the Day view. A row's "…" menu has the full action set, and Dismiss in the footer dismisses every checked suggestion.

### Week Grid

The Grid shows no suggestion rows. A day header with open suggestions carries a calendar chip with the count, beside the day total so the header keeps its height; clicking it opens the side panel scrolled to that day.

### Actions and copy

Every surface exposes the same actions through a right-click menu and a "…" button, from one feature module like `time-entry-actions.tsx`:

- **Add**: makes the entry.
- **Choose project…**: opens the suggestion's project picker.
- **Dismiss**: hides this occurrence. Undo toast.
- **Hide this meeting**: hides every occurrence of the series. Undo toast. Only for recurring events.
- **Forget this meeting**: removes the remembered project and task. Only when one exists.

The words _rule_, _series_ and _occurrence_ never appear in the UI.

### Settings

A **Calendar** page joins the Work group of Settings while a calendar plugin is on (`/settings/calendar`). Ajour has no Time settings page, and capacity targets stay in General.

- Filters: Hide all-day events (on), Hide declined events (on), Hide events marked free (on), Hide events I have not answered (off), Minimum length (0 minutes).
- Refresh every N minutes (10).
- **Remembered meetings**: a list with the label, the project and task or "Hidden", the connection when there is more than one, and Remove.

The plugin's own fields, such as the calendar address, stay on its Settings > Plugins page.

## Disabling and removing

- Disabling or uninstalling the plugin hides the Calendar button, the cards, the Day section and the Settings page at once. Decisions and remembered meetings stay, so enabling it again restores everything.
- Entries keep their note and link to nothing. They never change when the calendar does.
- Removing a connection deletes its decisions and remembered meetings after a confirmation that says how many remembered meetings will be lost.

## Privacy and security

- The host receives only the fact fields above. The ICS plugin drops attendees, descriptions, locations and links before answering.
- Fetched events never touch disk. Decisions store an occurrence key, not a title. The only persisted calendar text is a remembered meeting's label and the note of an entry the user added.
- The calendar address is a bearer secret: the field is `url` with `secret: true`, the renderer masks it, the API merges it like a token, and no log, wide event, error message or support bundle may contain it.
- The plugin accepts `https` only, follows at most three redirects and only to `https`, times out at 20 seconds and reads at most 5 MB.
- Entries added from suggestions reach an agent through MCP like any entry (ADR 0004). Suggestions do not.

## The ICS plugin

`les-cabochons/ajc-ics`, outside this repository, imports no Ajour source and targets plugin API 3. Connection fields: Label, Calendar address (secret, required), Your email (optional, used to find the user's own reply in the attendee list). Help text says the address grants read access to the whole calendar and where to reset it: Google "Reset private URLs", Outlook "Unpublish".

The plugin fetches the feed, parses it with an iCalendar library, expands recurrences for the requested range with `RRULE`, `EXDATE` and `RECURRENCE-ID` overrides, resolves `VTIMEZONE` and `X-WR-TIMEZONE`, treats floating times in the request's time zone, maps `STATUS`, `TRANSP` and the user's `PARTSTAT`, and returns facts. Its `seriesId` is the UID of a recurring event. Fixtures cover a Google feed, an Outlook feed and an Exchange feed.

Known limits, stated on the plugin page: Google serves the feed from a cache that can lag by hours; some tenants disable publishing, and only an OAuth plugin will work there.

## Testing

- Shared: schema tests for the manifest, the catalog and the calendar contract, including the bounds.
- API: host dispatch, capability assertion, route and worker lifetime tests, modelled on the code host ones.
- Domain: `calendar-suggestions.test.ts` for day assignment, midnight crossing, every filter, decisions, re-suggestion after a deleted entry, rules with missing projects, accept, accept several, dismiss, hide, forget, and Undo.
- Web: store tests for the new records and their defaults, and the side panel's bulk add.
- Manual: a development directory plugin with fixture feeds, then the real ICS plugin against the three providers.

## Slices

All five ship in the first release.

1. The `calendar` capability: contract, manifest, catalog, host dispatch, API route, plugin page, developer reference.
2. `ajc-ics`, in parallel with slice 1 against the contract.
3. Suggestions domain module, records, runtime fetch and cache, Undo, and the Settings section.
4. Days cards and the Day section, with the shared actions.
5. The side panel with bulk add, the top bar button and the Grid count chips.

Later, in separate specs: OAuth in the host, then the Google Calendar and Microsoft Graph plugins.
