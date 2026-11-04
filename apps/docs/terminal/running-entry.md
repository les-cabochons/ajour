# The running entry

One entry runs at a time, and it is always on today. The commands on this page do what the [running entry](/time/running-entries) does in the window: start, switch, stop, continue and discard.

## Start an entry

`ajour start [TASK] [-m NOTE] [-d DURATION]` starts an entry today and prints its row:

```console
$ ajour start acme/backend -m "Rate limiter retries"
●  0:00  ACME  05 Backend  Rate limiter retries  c41ee90
```

Name the task as `PROJECT/TASK`, as `TASK` alone when only one active task matches, or with its [pinned key](/projects/tasks#pin-a-task), `1` to `0`:

```sh
ajour start acme/backend      # project code, then task
ajour start backend           # the only task that matches "backend"
ajour start 1                 # the task pinned to 1
```

Matching ignores case and accents, and takes an exact name first, then the start of a name, then any part of it. When several tasks match, nothing starts and `ajour` lists them, exit 4:

```console
$ ajour start review
error: "review" matches 2 tasks:
  ACME/08 Code review
  AJR/04 Review
Say which, such as: ajour start "AJR/04 Review"
```

[Shell completion](/terminal/shell#completion) completes task names after `ajour start`.

### Start late

You started work 20 minutes ago. `-d` makes the entry count on from that time, as **Hours** does before **Start** in the window:

```console
$ ajour start export -d 20m -m "Fix export rounding"
●  0:20  AJR  07 Export  Fix export rounding  3f9a2c1
```

### Start without a task

`ajour start` alone starts an empty entry, as <kbd>S</kbd> does in the app. Name it once you know what you're on:

```console
$ ajour start
●  0:00  —  —  Untitled entry  7a20b1c
Set its task with: ajour edit running TASK
$ ajour edit running ajr/export -m "Fix export rounding"
●  0:12  AJR  07 Export  Fix export rounding  7a20b1c
```

## Switch

Starting while an entry runs saves the running one first, and starts the new one at the same instant, without a prompt. This is a Switch. The saved row comes first:

```console
$ ajour start acme/meetings -m "Weekly sync"
   1:28  ACME  05 Backend   Rate limiter retries  c41ee90  saved
●  0:00  ACME  03 Meetings  Weekly sync           91c0aa3
```

## See what runs

`ajour status` shows the running entry, counted to the second, with when it started counting and today's total against the day's target:

```console
$ ajour status
● 1:24:07  Fix export rounding
  AJR · 07 Export · since 13:20 · today 6:39 of 8:00
```

With nothing running, it names the entry you saved last, on any day:

```console
$ ajour status
○ Nothing running · today 5:15 of 8:00 · last: 04 Review, 45m ago
```

A day without a target shows the total alone.

### Short and watch

`-s` prints one line, for a status bar or a prompt:

```console
$ ajour status -s
● 1:24 Fix export rounding
```

When nothing runs, `-s` prints the `--idle` text, or nothing. It never prints an error: while Ajour is out of reach it prints nothing and exits 0. It has no color unless you pass `--color always`.

`-w` redraws the status each second until you press <kbd>q</kbd> or <kbd>Ctrl</kbd>+<kbd>C</kbd>. It asks Ajour again every ten seconds and counts on in between. With `-s`, `-w` prints a new line each second instead, for bars that read a stream. See [Shell setup](/terminal/shell#status-bars).

`--json` prints the running entry as Ajour returns it, under `running`, which is `null` when nothing runs:

```sh
ajour status --json | jq -r '.running.note // empty'
```

## Fix the running entry

`ajour edit running` changes the running entry's task, note or counted time. It keeps running, as **Save** in its editor does:

```console
$ ajour edit running ajr/review -m "PR #512, #514"
●  1:24  AJR  04 Review  PR #512, #514  3f9a2c1
```

`-d` corrects the counted time, and the entry counts on from it. `-d 0` starts the count over:

```console
$ ajour edit running -d 1:00
●  1:00  AJR  07 Export  Fix export rounding  3f9a2c1
```

`-m ""` clears the note.

## Stop

`ajour stop` stops the running entry and saves it on the day it started. It prints the saved row, then today's total against the day's target:

```console
$ ajour stop
   1:31  AJR  07 Export  Fix export rounding  3f9a2c1  saved
Today 6:46 of 8:00
```

When nothing runs, Ajour refuses and the command exits 1:

```console
$ ajour stop
refused: No entry is running.
```

In a script that stops "if anything runs", use `ajour stop || true`.

## Continue

`ajour continue [ENTRY]` counts more time on an entry, as **Continue** does in the app. Without an ENTRY, it continues `last`: the entry you saved or edited most recently, on any day.

Today's entry resumes with its saved time:

```console
$ ajour continue
●  1:31  AJR  07 Export  Fix export rounding  3f9a2c1
```

Another day's entry stays as it is, and a new entry starts today with its task and note:

```console
$ ajour continue 5b2e
●  0:00  ACME  05 Backend  Rate limiter retries  e91c4b7
Started a new entry today with Monday's task and note.
```

An entry that runs is saved first, as in a Switch. See [Saved entries](/terminal/entries#find-an-entry) to find an entry's id.

## Discard

`ajour discard` throws away the time the running entry counted since it last started, as **Discard** does. An entry started from nothing disappears. A continued entry keeps its saved time.

```console
$ ajour discard
Discarded 0:04 on 07 Export. Undo with: ajour undo
$ ajour undo
Undid: Discarded the running entry
```

[Undo](/terminal/entries#undo) works while the toast shows in the window.
