# Calendar API

A calendar provides the user's calendar events for a range of days, as facts: when each event starts and ends, its title, and how the user answered it. Ajour shows them in the Time view as suggestions, and the user adds the ones they want as time entries. The capability is read-only. Ajour never writes to the calendar and never stores the events it receives. This page is the reference for plugin API version 3.

Declare `"calendar": {}` in the manifest's [capabilities](/developers/manifest#capabilities), and export `validateConnection`, as for a backlog plugin, and `listCalendarEvents`.

## listCalendarEvents

```ts
export async function listCalendarEvents(
  connection: PluginConnection,
  request: { from: string; to: string; timeZone: string },
): Promise<CalendarListEventsResult>;
```

Ajour calls it when the user opens a week in the Time view, presses **Refresh**, and on a timer while the window is visible. `from` and `to` are local dates as `YYYY-MM-DD`, both included, at most 62 days apart. `timeZone` is the user's IANA time zone, such as `America/Toronto`. Use it for floating times and all-day dates.

Return every occurrence that overlaps the range, at most 1,000:

- Expand recurring events into one fact per occurrence. Give every occurrence the same `seriesId`, and the same `eventId` unless the provider gives each occurrence its own.
- Include cancelled occurrences with `status: "cancelled"`. Ajour hides them, and uses them to hide an occurrence it showed before.
- Set `response` to the user's own reply. Use `unknown` when you cannot tell who the user is.
- Set `busy: false` for events marked free.

### What not to send

Send the fields below and nothing else. Ajour drops any other field, but your plugin should never read more than it needs:

- No attendees, organizer names, descriptions, locations, conference links or attachments.
- No calendar address, token or other connection value, including inside an error message. Ajour replaces secret connection values in error messages with `[secret]`, but do not rely on it.

Titles longer than 200 characters are cut. An event the provider shows without a title, such as a private one, has an empty `title`.

## Types

```ts
interface CalendarListEventsResult {
  events: CalendarEventFacts[];
}

interface CalendarEventFacts {
  /** The provider's id of the event, the UID in ICS. */
  eventId: string;
  /** Shared by every occurrence of a recurring event. Leave it out for a one-off. */
  seriesId?: string;
  /** Unix milliseconds. */
  startsAt: number;
  /** Unix milliseconds. Not before `startsAt`. */
  endsAt: number;
  allDay: boolean;
  /** Empty when the provider hides it. */
  title: string;
  status: "confirmed" | "tentative" | "cancelled";
  /** The user's own reply. */
  response: "accepted" | "tentative" | "declined" | "needsAction" | "unknown";
  /** False for an event marked free. */
  busy: boolean;
  isOrganizer?: boolean;
}
```

Ajour identifies an occurrence by `eventId` and `startsAt` together, and a recurring meeting by `seriesId`. Keep both stable across calls. If they change, the user's choices for those meetings are lost.

## Errors

Throw an `Error` with a message the user can act on, such as "The calendar address returned 404. Reset it in Google Calendar and paste the new one." Ajour shows the message on the connection and in the Time view, and keeps the events it last received.

## Connection fields

A calendar usually needs one secret field. For an ICS address:

```json
{
  "id": "calendarUrl",
  "label": "Calendar address",
  "type": "url",
  "required": true,
  "secret": true,
  "helpText": "Anyone with this address can read your whole calendar. Reset it in your calendar's settings if it leaks."
}
```

See [Secret fields](/developers/manifest#secret-fields).
