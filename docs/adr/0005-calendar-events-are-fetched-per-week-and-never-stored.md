# Calendar events are fetched per week and never stored

A calendar plugin gives Ajour the user's events so the Time view can suggest them as entries. The events are the most private data Ajour has touched so far: a calendar lists who the user meets, when, and under which subject. The local-first boundary already forbids uploading meeting subjects, organizers or locations. This decision keeps them out of Ajour's own store as well.

Ajour asks the plugin for one date range at a time, holds the answer in renderer memory for a few minutes, and persists only what the user decided: which occurrences they added or dismissed, keyed by an opaque occurrence key, and which recurring series they remembered or hid, keyed by the series id with the title as a label. An entry the user added keeps the title as its note, because that is what the user chose to record.

The plugin contract carries only the fields a suggestion needs: ids, start, end, all-day, title, status, the user's reply, busy and organizer. The plugin drops attendees, descriptions, locations and links before answering, and the host validates the shape, so a plugin cannot widen it.

## Considered options

- **Store the fetched events like pull requests.** Rejected. Pull request facts are mostly public work data and the list needs a lifecycle across syncs. Suggestions have no lifecycle: an event is either shown or decided, and a decision is enough to hide it on the next fetch. Storing events would put the calendar on disk for no feature.
- **Keep the events in the local API as a cache, like pull request content.** Rejected. Suggestions are small, and a cache that survives a restart is the thing this decision avoids.
- **Store the full event on each decision.** Rejected. A dismissed occurrence needs only its key, and an added one has its entry.
- **Route events through the connector capability as import candidates.** Rejected. Connector candidates become backlog items and go through the sync review; an event becomes an entry, with its own filters, its own decisions and no remote write. A separate capability keeps both contracts small.
- **Extend the plugin host so plugins can persist state.** Rejected. Plugins stay stateless workers. A plugin that needs a sync token can come back with a spec of its own.

## Consequences

- Suggestions need the local API and the network at the moment the user looks. Offline, the Time view shows no suggestions and says nothing about events it saw earlier.
- Nothing calendar-related reaches an agent over MCP except entries the user added, which travel like any entry (ADR 0004).
- Deleting an entry makes its event a suggestion again, since the decision record points to an entry that no longer exists.
- Removing a connection deletes its decisions and remembered meetings. Uninstalling the plugin keeps them, so a reinstall restores the user's choices.
- The ICS calendar address is a bearer secret stored as a secret connection value. It never appears in logs, wide events or error messages.
- A later OAuth plugin changes how a connection authenticates, not what Ajour stores.
