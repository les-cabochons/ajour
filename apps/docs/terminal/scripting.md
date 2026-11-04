# Scripts and pipes

`ajour` is made to sit in a pipe. Data goes to stdout, sentences go to stderr, the exit code says what happened, and output changes shape when stdout isn't a terminal.

## stdout and stderr

Rows and data go to **stdout**: an entry's row, the lines of `ajour log`, JSON.

Everything said to you goes to **stderr**: today's total after a stop, how to undo, warnings, errors.

```console
$ ajour stop 2>/dev/null
   1:31  AJR  07 Export  Fix export rounding  3f9a2c1  saved
$ ajour discard >/dev/null
Discarded 0:04 on 07 Export. Undo with: ajour undo
```

## Exit codes

| Code | Meaning                                                            | stderr starts with |
| ---- | ------------------------------------------------------------------ | ------------------ |
| `0`  | Done.                                                              |                    |
| `1`  | Ajour refused the action, with its own reason.                     | `refused:`         |
| `2`  | A bad command, option or value.                                    | `usage:`           |
| `3`  | Ajour is out of reach: not running, MCP off, or the token revoked. | `error:`           |
| `4`  | A task, project or entry matched nothing, or several.              | `error:`           |

Exits 2 and 4 come before any write, so nothing changed, though finding a task or entry may read from Ajour first. Exits 1 and 3 can follow a change that went through: `ajour stop` saves the entry, then reads today's total, and that read can fail. Check with `ajour status` or `ajour log` before retrying a write. With exit 4, stderr lists the candidates.

```sh
ajour start "$1"
case $? in
  3) echo "Start Ajour first." >&2 ;;
  4) echo "Name the task more precisely." >&2 ;;
esac
```

`ajour stop` exits 1 when nothing runs, so a script that stops "if anything runs" uses `ajour stop || true`.

## Output in a pipe

When stdout isn't a terminal:

- `ajour log` prints [tab-separated values](/terminal/log#in-a-pipe) with a header row, ISO dates and decimal hours with a dot.
- `ajour projects` prints tab-separated values too: `project`, `task`, `key` and `commits_as`.
- Rows are whole, never cut to a width, and without color.
- `ajour log --format workday` prints only the [four Workday columns](/terminal/workday#in-a-pipe).

Pass `--format table` to keep the table in a pipe, or `--format tsv` to get values on a terminal.

## JSON

`--json` prints the output of Ajour's agent tool as it is. Every command that reads or changes entries takes it. Times are in minutes, and ids are whole: take the first 7 characters for the short id.

```console
$ ajour start acme/meetings --json | jq -r '.running.shortId[:7]'
91c0aa3
```

`ajour log --json` has `entries`, `running` and `targets`. See [Read your time](/terminal/log#json).

## Color

Color is on for a terminal, and off in a pipe and when `TERM` is `dumb`.

- `--color always` or `--color never` wins over everything.
- `NO_COLOR`, set to anything but empty, turns color off.
- `CLICOLOR_FORCE`, set to anything but empty or `0`, turns color on in a pipe.

TSV, CSV, JSON and the Workday lines in a pipe never hold color or escape codes. `ajour status -s` has no color unless you pass `--color always`.

## Quiet

`-q` prints nothing on success for the commands that change something, for `ajour connect` and for `ajour projects`. Errors still print, and the exit code still tells. `ajour log` and `ajour status` print as usual.

```sh
ajour -q start acme/backend -m "On call"
```

## Recipes

Each of these runs as shown, in bash, zsh or any POSIX shell.

### Hours this week

The TSV's third column holds hours, the running entry's included:

```console
$ ajour log week | awk -F'\t' 'NR > 1 { h += $3 } END { printf "%.2f\n", h }'
22.15
```

The same from JSON. The running entry's time is in `.running.countedMinutes`. When it continues a saved entry, that entry also sits in `entries` with `state: "running"`, and `countedMinutes` already includes its minutes, so leave it out:

```console
$ ajour log week --json | jq '[(.entries[] | select(.state != "running") | .minutes), .running.countedMinutes // 0] | add / 60'
22.15
```

### Hours per day, or per project

Any range works, such as `10-01..10-31` for October.

```console
$ ajour log week | awk -F'\t' 'NR > 1 { h[$1] += $3 } END { for (d in h) printf "%s\t%.2f\n", d, h[d] }' | sort
2026-11-02	8.00
2026-11-03	7.50
2026-11-04	6.65
```

```console
$ ajour log week | awk -F'\t' 'NR > 1 { h[$4] += $3 } END { for (p in h) printf "%s\t%.2f\n", p, h[p] }' | sort -t "$(printf '\t')" -k2,2nr
ACME	12.00
AJR	10.15
```

### What you did yesterday

For a stand-up, the task and note of each of yesterday's entries:

```console
$ ajour log yesterday | tail -n +2 | cut -f5,6
03 Meetings	Sprint planning
Temp migration	Schema dry run on the staging copy
04 Review	PR #510
```

### Notes not committed yet

```console
$ ajour log week --uncommitted --json | jq -r '.entries[].note, (.running.note // empty)'
Schema dry run on the staging copy
PR #510
PR #512, #514
Fix export rounding
```

### A spreadsheet of last month

```sh
ajour log 10-01..10-31 --format csv > october.csv
```

### Start on the branch you're on

Use the branch name as the note:

```sh
ajour start ajr/review -m "$(git branch --show-current)"
```

Or keep the running entry's note in step with the branch, from a `post-checkout` hook. Make the file executable. When nothing runs, Ajour refuses and the hook goes on:

```sh
#!/bin/sh
# .git/hooks/post-checkout
[ "$3" = 1 ] || exit 0
ajour -q edit running -m "$(git branch --show-current)" 2>/dev/null || true
```

### Pick a task with fzf

`ajour projects` lists every active task. fzf picks one, and `cut` and `tr` turn it into `PROJECT/TASK`:

```sh
ajs() {
  task=$(ajour projects | fzf --header-lines=1 --delimiter='\t' --nth=1,2 | cut -f1,2 | tr '\t' /)
  [ -n "$task" ] && ajour start "$task" "$@"
}
```

```console
$ ajs -m "Fix export rounding"
●  0:00  AJR  07 Export  Fix export rounding  c41ee90
```

### Pick an entry with fzf

The id is the seventh column of `ajour log`:

```sh
id=$(ajour log week | fzf --header-lines=1 | cut -f7)
ajour edit "$id" -d 2:30
```

### Is anything running?

`ajour status -s` prints nothing when nothing runs, and nothing when Ajour is out of reach:

```sh
if [ -n "$(ajour status -s)" ]; then
  echo "An entry is running."
fi
```

### Name a token per script

`AJOUR_TOKEN` takes a token for one command, so a script can use its own [client](/app/agents), and you can revoke it alone:

```sh
AJOUR_TOKEN="$(pass show ajour/reports)" ajour log last-week --format csv
```
