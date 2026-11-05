# The ajour command

`ajour` records your time from a terminal. It starts and stops entries, fixes the ones you forgot, prints your day or your week, and hands your Workday lines to the clipboard. It prints plain rows on a terminal and tab-separated values in a pipe, so it fits into scripts, tmux and your prompt.

```console
$ ajour start acme/backend -m "Rate limiter retries"
●  0:00  ACME  05 Backend  Rate limiter retries  c41ee90
```

## How it works

`ajour` is a client of the Ajour app on the same machine. It has no data of its own.

- **It talks to the running app.** Each command connects to Ajour's [MCP endpoint](/app/agents), at `http://127.0.0.1:8787`, with its own client token. It calls the same agent tools an agent uses, prints the answer and exits.
- **The app owns the data and the rules.** A write from the terminal runs the same action as the button in the window, with the same checks. When Ajour refuses, such as on a submitted week, `ajour` prints Ajour's reason word for word after `refused:`.
- **Every change shows its Undo toast** in the window, as if you had clicked. `ajour undo` presses it from the terminal.
- **The window can stay closed.** With **Keep Ajour running when the window closes** on, in [Settings › General](/app/settings), closing the window leaves Ajour in the tray, or the menu bar on macOS, and `ajour` keeps working. Quit Ajour and commands stop with `Ajour isn't running`.

What you change in the terminal shows in the window at once, and what you change in the window shows in the next command.

## A short tour

Start an entry, 20 minutes late:

```console
$ ajour start export -d 20m -m "Fix export rounding"
●  0:20  AJR  07 Export  Fix export rounding  3f9a2c1
```

See what runs, and today's total against the day's target:

```console
$ ajour status
● 1:24:07  Fix export rounding
  AJR · 07 Export · since 13:20 · today 6:39 of 8:00
```

Stop it. Ajour saves it on today:

```console
$ ajour stop
   1:31  AJR  07 Export  Fix export rounding  3f9a2c1  saved
Today 6:46 of 8:00
```

Save the review you forgot yesterday:

```console
$ ajour add ajr/review -d 45m -m "PR #512" --on yesterday
   0:45  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov
```

Print the day:

```console
$ ajour log
Wednesday 4 November 2026 · today   6:46 of 8:00  ▮▮▮▮▮▮▮▮▯▯
────────────────────────────────────────────────────────────
   1:31  AJR   07 Export    Fix export rounding      3f9a2c1
   2:00  AJR   04 Review    PR #512, #514            b7e1d04
   0:45  ACME  03 Meetings  Weekly sync           ✓  91c0aa3
   2:30  ACME  05 Backend   Rate limiter retries  ✓  0d4f77e

4 entries · 2 committed · 2 to commit
```

On Friday, copy the week's lines for Workday:

```sh
ajour log week --format workday | wl-copy
```

## Read a row

Every command that writes answers with the entry's row, and `ajour log` prints the same rows:

```
●  1:24  AJR   07 Export    Fix export rounding     3f9a2c1
   0:45  ACME  03 Meetings  Weekly sync          ✓  91c0aa3
   0:45  AJR   04 Review    PR #512                 b7e1d04  Tue 3 Nov
```

From left to right:

- `●` when the entry runs.
- Its time, in hours and minutes.
- The project's code and the task.
- The note.
- `✓` when the entry is [committed](/time/commit): Workday holds it as it is in Ajour.
- Its short id. Commands that take an ENTRY take this id, or its first 4 characters or more.
- Its day, when it isn't today.

A row from a Stop or a Switch ends with `saved`. In `ajour log`, an entry on a [Local only](/projects/tasks) task ends with `local`, and one on a task with no Workday task yet ends with `not known yet`.

On a terminal, rows are cut to its width: the note shrinks first, then the line ends with `…`. Nothing wraps. In a pipe, rows are whole and without color.

## In this section

- [Install and connect](/terminal/install): download, PATH, the token, and where files live.
- [The running entry](/terminal/running-entry): start, switch, stop, continue, discard and status.
- [Saved entries](/terminal/entries): add, edit, move, duplicate, delete and undo.
- [Read your time](/terminal/log): `ajour log` for a day, a range or a week.
- [Lines for Workday](/terminal/workday): the Commit page's lines, ready to paste.
- [Scripts and pipes](/terminal/scripting): output streams, exit codes, JSON and recipes.
- [Shell setup](/terminal/shell): completion, man pages, tmux, Starship and status bars.
- [Command reference](/terminal/reference): every command, and how to name tasks, entries, days and ranges.
