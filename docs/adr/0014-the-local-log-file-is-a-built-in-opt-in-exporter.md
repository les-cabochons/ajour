# The local log file is a built-in, opt-in exporter

Ajour's wide events went nowhere (#304). The first exporter writes them to a file on the user's computer, for a diagnostics viewer inside Ajour (#438). It is built into the desktop main process, not a plugin: plugins are untrusted, run sandboxed and never touch files (ADR 0007, ADR 0010), and every runtime's events already meet in main, where the local API runs and where the renderer will send its batches over IPC. Main's events and the local API's go through one sink, which hands each event to the developer's console when `AJOUR_WIDE_EVENTS=console` asks for it, and to the file.

This refines ADR 0011's "logging plugins … to a file": the first file exporter is built in, not a plugin.

ADR 0011 counts a local file as a sink, so the file follows the rules of every sink. It is off until the user turns it on. Before a line is written, a privacy filter keeps each field only where the catalog declares it, holding only what the catalog says the field holds (a scalar or a list of scalars, unless the catalog gives it a shape such as `steps` or `counts`), and a `sensitive` field (the days, weeks and durations of time records, and every error message) only when the user allowed sensitive fields for this sink. The classes come from the catalog; the filter keeps no list of its own. Sensitive fields are off by default.

The file is one NDJSON file per UTC day, `userData/logs/events/YYYY-MM-DD.ndjson`. A sweep at launch, every hour and when a limit changes deletes the days past the retention, then the oldest days past the size limit: 7 days and 250 MB by default, chosen from 1, 7, 30 or 90 days and 100 MB, 250 MB or 1 GB. It never deletes the file being written. Only the process that holds the single instance lock opens the file. Writing never breaks the work: events are queued (at most 10,000 lines, counting the events it drops) and written in batches, the last ones synchronously at `will-quit`, and a failed write or a full disk stops writing with a warning the settings page shows. Saving the settings again, or the next launch, resumes it.

## Considered options

- **A logging plugin that writes the file.** Rejected. A plugin may not touch files, and loosening that for logging would give an untrusted package every event and a path to write. Grafana and Application Insights exporters may later be plugins or built in, behind the same sink and filter.
- **On by default, as a local file never leaves the computer.** Rejected. ADR 0011 treats a local file as a sink like any other, and a user who never looks at diagnostics shouldn't pay for them in disk or in what another person with the computer could read.
- **One sensitive fields setting for all sinks.** Rejected. A user may allow durations in a local file and not in a remote backend, so the setting belongs to each sink.
- **Keep the sensitive fields in a list the filter owns.** Rejected. Two lists drift; the catalog already classes each field, and a new field gets its class there.
- **Keep fields the catalog doesn't declare.** Rejected. The renderer's batches cross a process boundary, and a field nobody classed shouldn't reach a file. The filter drops it.
- **One file, rotated by size.** Rejected. Day files make the age limit a file deletion, and let the viewer read only the days it shows.
- **Make the console replace the file when the developer switch is on.** Rejected. A developer testing the viewer needs both, so the sink fans out to each.

## Consequences

- With logging off nothing changes: the sink tells the emitter it isn't accepting, so no event is built for it, and no file or folder is created.
- Saving settings refuses a value outside its closed set and changes nothing; only the stored file takes defaults. Deleting all logs removes the day files, and the folder when nothing else is in it.
- Turning logging on, saving its settings and deleting all logs are IPC channels with their own events, and each sweep is a `logs.sweep` job, so the file records its own upkeep.
- Today's file is never deleted, so it can go past the size limit until the day ends.
- Writing stops at the first failure until the user saves the settings or restarts Ajour. A disk that fills keeps failing, so it is not retried in a loop.
- The web build has no file to write to, and keeps sending its events nowhere.
