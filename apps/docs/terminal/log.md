# Read your time

`ajour log [RANGE]` prints the entries of a day, of several days or of a week. On a terminal it prints a table. In a pipe it prints [tab-separated values](#in-a-pipe), one line per entry.

## A day

Without a RANGE, `ajour log` prints today:

```console
$ ajour log
Wednesday 4 November 2026 · today   6:39 of 8:00  ▮▮▮▮▮▮▮▮▯▯
────────────────────────────────────────────────────────────
●  1:24  AJR   07 Export    Fix export rounding      3f9a2c1
   2:00  AJR   04 Review    PR #512, #514            b7e1d04
   0:45  ACME  03 Meetings  Weekly sync           ✓  91c0aa3
   2:30  ACME  05 Backend   Rate limiter retries  ✓  0d4f77e

4 entries · 1 running · 2 committed · 1 to commit
```

The header has the day's total, its target and a ten-cell bar against the target. The running entry shows with `●` and its time so far, and counts once. Each row reads as [described here](/terminal/#read-a-row). The last line counts the entries, the running one, the committed ones and the ones left to commit.

## Several days, or a week

A range groups the entries under each day, with the day's total against its target:

```console
$ ajour log week
Week 45 · Mon 2 – Sun 8 Nov 2026                    22:09 of 40:00  1:51 behind
───────────────────────────────────────────────────────────────────────────────
Mon 2                                                              8:00 of 8:00
   3:00  AJR   07 Export       Fix export rounding    ✓  2a9e1f0
   1:30  AJR   09 Admin        Expenses               ✓  5c17e08  local
   3:30  ACME  05 Backend      Rate limiter           ✓  4e0c2b8

Tue 3                                                              7:30 of 8:00
   2:15  ACME  03 Meetings     Sprint planning        ✓  d8b2a40
   3:00  ACME  Temp migration  Schema dry run on th…     66e03f9  not known yet
   2:15  AJR   04 Review       PR #510                   1b9cc3d

Wed 4 · today                                                      6:39 of 8:00
●  1:24  AJR   07 Export       Fix export rounding       3f9a2c1
   2:00  AJR   04 Review       PR #512, #514             b7e1d04
   0:45  ACME  03 Meetings     Weekly sync            ✓  91c0aa3
   2:30  ACME  05 Backend      Rate limiter retries   ✓  0d4f77e

Thu 5                                                                 — of 8:00
Fri 6                                                                 — of 8:00

10 entries · 1 running · 6 committed · 3 to commit
```

A week's header adds your pace against the targets of its days up to today: `on pace`, `1:51 behind` or `0:30 ahead`. A day without time is one line. Saturday and Sunday show only when they have time or a target.

`local` marks an entry on a [Local only](/projects/tasks) task, and `not known yet` one on a task with no Workday task yet. Both show on archived tasks and projects too.

## Ranges

| RANGE                      | Days                                                  |
| -------------------------- | ----------------------------------------------------- |
| `today`, `yesterday`       | That day. `today` is the default.                     |
| `mon` … `sun`              | The most recent such day, today included.             |
| `2026-11-03`, `11-03`      | That date. Without a year, this year.                 |
| `mon..wed`, `10-28..11-03` | Both days and the days between them.                  |
| `week`, `last-week`        | Monday to Sunday of this week, or of the week before. |
| `2026-W45`                 | An ISO week, Monday to Sunday.                        |

A range covers 62 days at most, and puts the earlier day first. Print a longer stretch in parts:

```console
$ ajour log 2026-01-01..2026-06-01
usage: A range covers at most 62 days, and "2026-01-01..2026-06-01" covers 152. Print it in parts.
```

## Totals per day

`-s` prints one line per day, each with a bar against its target:

```console
$ ajour log week -s
Week 45 · Mon 2 – Sun 8 Nov 2026  22:09 of 40:00  1:51 behind
─────────────────────────────────────────────────────────────
Mon 2   8:00  ▮▮▮▮▮▮▮▮
Tue 3   7:30  ▮▮▮▮▮▮▮▯
Wed 4   6:39  ▮▮▮▮▮▮▮▯  ● running
Thu 5      —  ▯▯▯▯▯▯▯▯
Fri 6      —  ▯▯▯▯▯▯▯▯
```

## Totals per task

`--by task` prints one line per task over the range, most time first, with a bar. It marks the running entry's task, and the tasks that are local or not known yet:

```console
$ ajour log week --by task
Week 45 · Mon 2 – Sun 8 Nov 2026  22:09 of 40:00  1:51 behind
─────────────────────────────────────────────────────────────
   6:00  ACME  05 Backend      ▮▮▮▮▮▮▮▮▮▮▮▮
   4:24  AJR   07 Export       ▮▮▮▮▮▮▮▮▮     ● 1:24 running
   4:15  AJR   04 Review       ▮▮▮▮▮▮▮▮▮
   3:00  ACME  03 Meetings     ▮▮▮▮▮▮
   3:00  ACME  Temp migration  ▮▮▮▮▮▮        not known yet
   1:30  AJR   09 Admin        ▮▮▮           local
```

`-s` and `--by task` print this table in a pipe too. They refuse `--format tsv`, `csv` and `json`, which print one line per entry.

## Filters

Four options keep only some entries. The totals in the header count only what is left.

| Option              | Keeps                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `--project PROJECT` | That project's entries. PROJECT matches a code, a name or a full name, as in `PROJECT/TASK`. |
| `--task TASK`       | That task's entries. TASK matches as it does for `ajour start`.                              |
| `--committed`       | The entries Workday holds as they are.                                                       |
| `--uncommitted`     | The rest, the running entry included.                                                        |

```console
$ ajour log week --task review
Week 45 · Mon 2 – Sun 8 Nov 2026  4:15 of 40:00  19:45 behind
─────────────────────────────────────────────────────────────
Mon 2                                               — of 8:00

Tue 3                                            2:15 of 8:00
   2:15  AJR  04 Review  PR #510        1b9cc3d

Wed 4 · today                                    2:00 of 8:00
   2:00  AJR  04 Review  PR #512, #514  b7e1d04

Thu 5                                               — of 8:00
Fri 6                                               — of 8:00

2 entries · 2 to commit
```

A PROJECT or TASK that matches nothing, or several, lists the candidates and exits 4:

```console
$ ajour log --project a
error: "a" matches 2 projects:
  ACME  Acme Platform
  AJR  Ajour Desktop
Say which with more of its code or name.
```

## Formats

`--format` picks the output: `table`, `tsv`, `csv`, `json` or [`workday`](/terminal/workday). Without it, you get `table` on a terminal and `tsv` in a pipe. `--json` is the same as `--format json`.

### In a pipe

`tsv` prints a header row, then one line per entry:

```console
$ ajour log week | head -4
date	state	hours	project	task	note	id
2026-11-02	committed	3.00	AJR	07 Export	Fix export rounding	2a9e1f0
2026-11-02	committed	1.50	AJR	09 Admin	Expenses	5c17e08
2026-11-02	committed	3.50	ACME	05 Backend	Rate limiter	4e0c2b8
```

- `date` is an ISO date.
- `state` is `saved`, `committed` or `running`.
- `hours` is decimal with a dot, two places: `1.40` for 1:24.
- `project` is the project's code.
- `id` is the short id other commands take.

There is no color and no escape code. A tab or a line break inside a note becomes a space, so every entry stays on one line.

`csv` prints the same columns, and quotes a field that holds a comma, a quote or a line break:

```sh
ajour log 2026-W44 --format csv > week44.csv
```

To keep the table in a pipe, ask for it. Add `--color always` for a pager that shows color:

```sh
ajour log week --format table --color always | less -R
```

### JSON

`--json` prints the output of Ajour's read tool as it is: the entries, the running entry, and each day's target. Times are in minutes:

```console
$ ajour log yesterday --json | jq -c '.entries[] | {date, minutes, task: .taskName, note}'
{"date":"2026-11-03","minutes":135,"task":"03 Meetings","note":"Sprint planning"}
{"date":"2026-11-03","minutes":180,"task":"Temp migration","note":"Schema dry run on the staging copy"}
{"date":"2026-11-03","minutes":135,"task":"04 Review","note":"PR #510"}
```

The running entry is under `running`, not in `entries`, with its time in `countedMinutes`. Each day's target is in `targets`, in hours. See [Scripts and pipes](/terminal/scripting#recipes) for what to do with it.
