# Command reference

Every command, and how to name what it works on. `man ajour-COMMAND`, or `ajour help COMMAND`, has each command's full page.

```
ajour [options] <command> [args]
```

## Global options

| Option            | Effect                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| `--json`          | Print Ajour's tool output as JSON. See [JSON](/terminal/scripting#json). |
| `--color WHEN`    | `auto`, `always` or `never`. See [Color](/terminal/scripting#color).     |
| `-q`, `--quiet`   | Print nothing on success. See [Quiet](/terminal/scripting#quiet).        |
| `-V`, `--version` | Print the command's version, and the app's when connected.               |
| `-h`, `--help`    | Show short help, for `ajour` or for a command.                           |

## Commands

### The running entry

| Synopsis                                     | Does                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ajour start [TASK] [-m NOTE] [-d DURATION]` | [Starts an entry today](/terminal/running-entry#start-an-entry). With an entry running, saves it first: a Switch. `-d` counts on from that time. |
| `ajour stop`                                 | [Stops and saves](/terminal/running-entry#stop) the running entry.                                                                               |
| `ajour discard`                              | [Throws away](/terminal/running-entry#discard) the running entry's time since it last started.                                                   |
| `ajour continue [ENTRY]`                     | [Counts more time](/terminal/running-entry#continue) on an entry, `last` by default.                                                             |
| `ajour status [-s [--idle TEXT]] [-w]`       | [Shows what runs](/terminal/running-entry#see-what-runs), and today's total.                                                                     |

### Entries

| Synopsis                                          | Does                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ajour add TASK -d DURATION [-m NOTE] [--on DAY]` | [Saves an entry](/terminal/entries#add-an-entry) without running it, today by default.                  |
| `ajour edit ENTRY [TASK] [-m NOTE] [-d DURATION]` | [Changes an entry](/terminal/entries#edit-an-entry), the running one included. `-m ""` clears the note. |
| `ajour move ENTRY --to DAY`                       | [Moves an entry](/terminal/entries#move-an-entry) to another day.                                       |
| `ajour dup ENTRY [--to DAY]`                      | [Copies an entry](/terminal/entries#duplicate-an-entry), on its own day by default.                     |
| `ajour rm ENTRY...`                               | [Deletes entries](/terminal/entries#delete-entries) in one action with one Undo.                        |
| `ajour undo`                                      | [Undoes the last change](/terminal/entries#undo) made from this terminal.                               |

### Reading

| Synopsis                                                                           | Does                                                                              |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ajour log [RANGE] [-s] [--by GROUP] [--format FORMAT]`                            | [Prints entries](/terminal/log) for a day, a range or a week.                     |
| `ajour log [RANGE] [--project PROJECT] [--task TASK] [--committed\|--uncommitted]` | [Keeps only some entries](/terminal/log#filters).                                 |
| `ajour log [RANGE] --format workday [--by day-task\|day\|task]`                    | [Prints the Commit page's lines](/terminal/workday).                              |
| `ajour projects [--format FORMAT]`                                                 | Lists projects and their active tasks, with pinned keys and what each commits as. |

`--format` takes `table`, `tsv`, `csv` or `json`, and `workday` for `ajour log`. `--by` takes `day` or `task` for the table.

### Setup

| Synopsis                        | Does                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `ajour connect [--token-stdin]` | [Pairs the terminal with Ajour](/terminal/install#connect).                        |
| `ajour completion SHELL`        | [Prints shell completion](/terminal/shell#completion) for `bash`, `zsh` or `fish`. |
| `ajour help [COMMAND]`          | [Opens the manual](/terminal/shell#the-manual).                                    |

## Grammar

### TASK

`PROJECT/TASK`, `TASK` alone, or a pinned key.

- **PROJECT** matches a project's code, its name or its full name.
- **TASK** matches a task's name, among active tasks.
- Matching ignores case and accents, and collapses spaces. It takes an exact name first, then the start of a name, then any part of it.
- Exactly one task must match. Otherwise nothing happens, and `ajour` lists the candidates, exit 4.
- A digit `1` to `0` is the task [pinned](/projects/tasks#pin-a-task) to that key. `0` is the tenth.

```
acme/backend    ACME's 05 Backend
backend         the only active task named like "backend"
"AJR/07 Export" quote a name with spaces
1               the task pinned to 1
```

### ENTRY

- An id from `ajour log`, or any start of it of 4 characters or more, as long as only one entry starts with it.
- `last`: the entry saved or edited most recently, on any day.
- `running`: the running entry.

Several matches exit 4 and list their rows. See [Find an entry](/terminal/entries#find-an-entry).

### DURATION

`1:30`, `1h30`, `2h`, `90m`, `45min`, `1.5` or `1,5`. A bare number is hours. Times are whole minutes, up to 24 hours. Only the running entry takes `0`, with `start -d 0` or `edit running -d 0`.

### DAY

| DAY                  | Is                                                                       |
| -------------------- | ------------------------------------------------------------------------ |
| `today`, `yesterday` | That day.                                                                |
| `mon` to `sun`       | The most recent such day, today included. `monday` to `sunday` work too. |
| `2026-11-03`         | That date.                                                               |
| `11-03`              | That date this year.                                                     |

### RANGE

A DAY, or:

| RANGE               | Covers                                                       |
| ------------------- | ------------------------------------------------------------ |
| `DAY..DAY`          | Both days, and the days between them. The earlier day first. |
| `week`, `last-week` | Monday to Sunday, this week or the week before.              |
| `2026-W45`          | An ISO week, Monday to Sunday.                               |

A range covers 62 days at most.

## Exit status

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | Done.                                                              |
| `1`  | Ajour refused the action, with its own reason.                     |
| `2`  | A bad command, option or value.                                    |
| `3`  | Ajour is out of reach: not running, MCP off, or the token revoked. |
| `4`  | A reference matched nothing or several things.                     |

## Environment

| Variable                     | Effect                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `AJOUR_TOKEN`                | The client token, in place of the saved one.                         |
| `AJOUR_URL`                  | Ajour's local address, `http://127.0.0.1:8787` by default.           |
| `XDG_CONFIG_HOME`            | Where the token is saved, in `ajour/token`.                          |
| `XDG_STATE_HOME`             | Where the last change's Undo is kept, in `ajour/last-undo`.          |
| `XDG_CACHE_HOME`             | Where task names for completion are kept, in `ajour/tasks.json`.     |
| `PAGER`                      | The reader for `ajour help` without man pages, `less -R` by default. |
| `NO_COLOR`, `CLICOLOR_FORCE` | Turn color off, or on in a pipe.                                     |

The defaults, and the Windows folders, are in [Where files live](/terminal/install#where-files-live).
