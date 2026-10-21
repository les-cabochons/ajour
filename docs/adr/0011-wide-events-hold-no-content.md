# Wide events hold no content

Every unit of work in Ajour emits one wide event (#304), and later the user can turn on logging plugins that send these events to Grafana, Application Insights or a file. So one rule covers every event, in every runtime: an event never holds content. Content is text written by the user, by another person or by a source tool (notes, titles, descriptions, comment bodies, mentions, toast and clipboard text); project, task, team and person names, connection labels and meeting subjects; emails and logins; search and filter text; agent prompts, questions, answers, tool inputs and outputs; and anything that locates or unlocks the user's data: file names and paths, URLs and hosts, source tool keys and IDs, repository names, secrets and tokens. An event holds Ajour's own random IDs, plugin IDs and versions, enum values, booleans, counts, operation durations, byte sizes, versions, status codes, error types and codes, route patterns and channel names.

Each field in the catalog (`packages/wide-events/catalog.ts`) declares a privacy class, and a field without one fails to compile. A field is `operational` unless it is one of two exceptions, which are `sensitive`: the days, weeks and durations of time records, and every error message. A future sink receives a sensitive field only if the user allows it for that sink. A message enters an event only through the scrubber: it replaces the connection's secret values with the redaction plugin errors use, then URLs, the user data path and the home directory, and cuts the message at 512 characters. What is left can still name a file or a host, so a scrubbed message stays sensitive.

ADR 0004, ADR 0005 and ADR 0008 already keep tool inputs, calendar titles and comment text out of logs, each for its own feature. This decision makes it one rule for every event.

## Considered options

- **Leave messages out, as the first agent.run event did (#334).** Rejected. An error's type and code rarely explain a failed sync or a plugin that times out. A scrubbed, sensitive message explains it, and stays off every sink the user hasn't allowed.
- **Log content locally only, and filter it before a remote sink.** Rejected. A local file is a sink too, and a filter that one runtime forgets leaks everything it was meant to hide. An event that never holds content needs no filter.
- **Hash names and titles, so events can be grouped by them.** Rejected. A short title or a project name is easy to guess from its hash, and Ajour's own IDs already group events by record.
- **One privacy class per event instead of per field.** Rejected. An event such as `time_entry.update` mixes operational IDs with a sensitive duration, and a sink that may not receive the duration should still receive the rest.

## Consequences

- An event can't say which project, item or meeting it was about in words. It names the record by Ajour's ID, which the user's own data resolves.
- A source tool's key, such as a Jira issue key or a comment's ID in its source, stays out even when it would make an event easier to read.
- A plugin's error message is redacted for the connection's secrets before it enters an event, as it is before it reaches a response or a stored last error.
- The canary privacy test (#311) runs representative flows with a marker string in every kind of content, and fails if any event contains it.
