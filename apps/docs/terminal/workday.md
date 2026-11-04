# Lines for Workday

`ajour log --format workday` prints the lines of the [Commit page](/time/commit): one line per task and day, with the project, the task, the hours and your notes, ready to paste into Workday.

```sh
ajour log [RANGE] --format workday [--by day-task|day|task]
```

## On a terminal

```console
$ ajour log week --format workday
Week 45 for Workday · Mon 2 – Sun 8 Nov 2026 · by day and task · hours use a comma
──────────────────────────────────────────────────────────────────────
Mon 2 Nov
  Ajour Desktop 07 Export       3,00    Fix export rounding
  Acme Platform 05 Backend      3,50    Rate limiter
Tue 3 Nov
  Acme Platform 03 Meetings     2,25    Sprint planning
  Ajour Desktop 04 Review       2,25    PR #510
Wed 4 Nov
  Ajour Desktop 04 Review       2,00    PR #512, #514
  Acme Platform 03 Meetings     0,75    Weekly sync, moved to 10:30
  Acme Platform 05 Backend      2,50    Rate limiter retries

Not sent     1:30 on Ajour Desktop / 09 Admin is local only.
Waiting      3:00 on Temp migration has no Workday task yet.
Running      1:24 on 07 Export is not listed. Stop it first.
```

Each week gets a header. The columns are padded and separated by tabs, so a row you select and copy pastes as four cells.

The lines below them explain the time that isn't in the lines:

- **Not sent**: time on a [Local only](/projects/tasks) task. It never goes to Workday.
- **Waiting**: time on a [Not known yet](/projects/tasks#commits-as) task. Choose what the task commits as, and its time joins the lines.
- **Running**: the running entry's time that isn't saved yet. Stop it to include it.

## In a pipe

In a pipe, only the four tab-separated values print: no header, no padding, no explanation and no color, even with `--color always`. That's what the clipboard wants:

```sh
ajour log week --format workday | wl-copy         # Wayland
ajour log week --format workday | xclip -sel clip # X11
ajour log week --format workday | pbcopy          # macOS
ajour log week --format workday | clip            # Windows
```

In PowerShell, `Set-Clipboard` works too. If accented notes paste wrong there, run `[Console]::OutputEncoding = [Text.UTF8Encoding]::new()` first: `ajour` writes UTF-8.

```console
$ ajour log week --format workday | cat
Ajour Desktop	07 Export	3,00	Fix export rounding
Acme Platform	05 Backend	3,50	Rate limiter
Acme Platform	03 Meetings	2,25	Sprint planning
Ajour Desktop	04 Review	2,25	PR #510
Ajour Desktop	04 Review	2,00	PR #512, #514
Acme Platform	03 Meetings	0,75	Weekly sync, moved to 10:30
Acme Platform	05 Backend	2,50	Rate limiter retries
```

## What the columns hold

1. **The project's full name**, the name Workday knows.
2. **The task, as it commits to Workday**: its [Commits as](/projects/tasks#commits-as) name.
3. **The hours**, with two decimals and a comma: `2,25` for 2:15.
4. **The notes**, merged with `|` when several entries share a line.

The Commit page's **Names** switch doesn't change these columns.

A field that holds a tab, a line break or a double quote is quoted, with its quotes doubled, so it pastes as one cell. On a terminal, a row with a quoted field skips the padding, and the other rows keep theirs.

## Group the lines

`--by` picks how the lines are grouped, as on the Commit page:

| `--by`              | Lines                                                   |
| ------------------- | ------------------------------------------------------- |
| `day-task`, default | One line per task and day, with the day's notes merged. |
| `day`               | One line per entry.                                     |
| `task`              | One line per task for each week, without days.          |

```console
$ ajour log week --format workday --by task | cat
Acme Platform	05 Backend	6,00	Rate limiter | Rate limiter retries
Ajour Desktop	04 Review	4,25	PR #510 | PR #512, #514
Ajour Desktop	07 Export	3,00	Fix export rounding
Acme Platform	03 Meetings	3,00	Sprint planning | Weekly sync, moved to 10:30
```

## Ranges

Any [RANGE](/terminal/log#ranges) works. Only the days you ask for count, even when the range crosses weeks: `ajour log fri..mon --format workday` prints two weeks, each with its own header on a terminal, and only those four days.

The format stands alone. Ajour refuses `--project`, `--task`, `--committed`, `--uncommitted`, `-s` and `--json` with it:

```console
$ ajour log week --format workday --task review
usage: Workday prints the Commit page's lines. Leave out --summary, --project, --task, --committed and --uncommitted.
```

## When plugins name tasks

A plugin can rename a task for Workday. If a task in the week has such a name and Ajour can't read the plugins' names within two seconds, it refuses rather than print the wrong name. Nothing prints, and the command exits 1:

```console
$ ajour log week --format workday
refused: Ajour couldn't read the plugins' task names. Try again.
```

## Then mark it committed

`ajour` copies the lines but doesn't mark anything as committed. Once Workday has them, press **Mark as committed** on the Commit page.
