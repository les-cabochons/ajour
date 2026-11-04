# Saved entries

These commands change the entries you already have, on any day, as the entry's actions do in the [Day view](/time/entries). Each prints the entry's row, and each keeps its Undo for `ajour undo`.

## Find an entry

Commands that take an ENTRY take one of these:

- **An id from `ajour log`**, the last column of each row, or the first 4 characters of it or more, as long as only one entry starts with them.
- **`last`**: the entry you saved or edited most recently, on any day.
- **`running`**: the running entry, for `ajour edit`.

```console
$ ajour log yesterday
Tuesday 3 November 2026                                7:30 of 8:00  ▮▮▮▮▮▮▮▮▮▯
───────────────────────────────────────────────────────────────────────────────
   2:15  ACME  03 Meetings     Sprint planning        ✓  d8b2a40
   3:00  ACME  Temp migration  Schema dry run on th…     66e03f9  not known yet
   2:15  AJR   04 Review       PR #510                   1b9cc3d

3 entries · 1 committed · 2 to commit
$ ajour edit 1b9c -d 2:30
   2:30  AJR  04 Review  PR #510  1b9cc3d  Tue 3 Nov
```

When a prefix matches several entries, nothing changes and `ajour` lists their rows, exit 4:

```console
$ ajour continue 3f9a
error: "3f9a" matches 2 entries:
     1:31  AJR  07 Export  Fix export rounding  3f9a2c1a
     0:45  AJR  04 Review  PR #512              3f9a2c1b  Tue 3 Nov
Say which with more of its id.
```

A prefix that matches nothing says `No entry has an id starting with "dead".`, exit 4.

In a pipe, `ajour log` prints the id in the seventh column, so you can find one by its note:

```console
$ ajour log week | awk -F'\t' '$6 == "PR #510" { print $7 }'
1b9cc3d
```

## Add an entry

`ajour add TASK -d DURATION [-m NOTE] [--on DAY]` saves an entry without starting anything, as **Save** does in the entry editor. It lands on today, or on the day `--on` names, and the row names that day when it isn't today:

```console
$ ajour add ajr/review -d 45m -m "PR #512" --on yesterday
   0:45  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov
```

```sh
ajour add 1 -d 0:30                 # the task pinned to 1, today
ajour add backend -d 2h --on 10-12  # 12 October this year
ajour add acme/meetings -d 1.5 --on fri
```

DAY is `today`, `yesterday`, `mon` to `sun` for the most recent such day, today included, a date such as `2026-11-03`, or `11-03` in this year. DURATION takes `1:30`, `1h30`, `90m` or `1.5`. See the [reference](/terminal/reference#grammar).

## Edit an entry

`ajour edit ENTRY [TASK] [-m NOTE] [-d DURATION]` changes an entry's task, note or time, as its form does:

```console
$ ajour edit b7e1d04 -d 1:00
   1:00  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov
```

```sh
ajour edit last acme/meetings -m ""   # another task, and no note
ajour edit 91c0 -m "Weekly sync, moved to 10:30"
```

`-m ""` clears the note. An edit that changes nothing exits 2 with `Say what to change: a TASK, -m NOTE or -d DURATION.`

When you change a committed entry, it loses its `✓`, and `ajour` says so on stderr. The change then shows on the [Commit page](/time/commit):

```console
$ ajour edit 91c0 -m "Weekly sync, moved to 10:30"
   0:45  ACME  03 Meetings  Weekly sync, moved to 10:30  91c0aa3
Now differs from what Workday holds. It shows as updated on the Commit page.
```

`ajour edit running` changes the running entry and it keeps running. See [The running entry](/terminal/running-entry#fix-the-running-entry).

## Move an entry

`ajour move ENTRY --to DAY` moves an entry to another day, as **Move to…** does, and prints its row with the day it landed on:

```console
$ ajour move b7e1d04 --to mon
   0:45  AJR  04 Review  PR #512  b7e1d04  Mon 2 Nov
```

The running entry can't move. Stop it first.

## Duplicate an entry

`ajour dup ENTRY [--to DAY]` copies an entry, on its own day as **Duplicate** does, or on another day with `--to`, as **Duplicate to…** does. The copy's row always names its day:

```console
$ ajour dup 91c0aa3 --to fri
   0:45  ACME  03 Meetings  Weekly sync  f0a9d12  Fri 30 Oct
```

The copy is a saved entry, even of a committed one. The running entry can't be copied. Stop it first.

## Delete entries

`ajour rm ENTRY...` deletes one entry or several, as **Delete** does, in one action with one Undo:

```console
$ ajour rm f0a9d12 b7e1d04
Deleted 2 entries. Undo with: ajour undo
```

Every ENTRY is found before anything is deleted. If one matches nothing or several entries, none is deleted, exit 4. The running entry can't be deleted: stop or discard it first. A committed entry's deletion shows on the Commit page until Workday has it.

## Undo

`ajour undo` presses the Undo of the last change made from this terminal, as its toast in the window would. The toast names the client, such as **Terminal: Edited an entry**.

```console
$ ajour edit b7e1d04 -d 1:00
   1:00  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov
$ ajour undo
Undid: Edited an entry
```

The rules are the app's: only Ajour's last action can be undone, and only while its toast shows. Once anything changes after it, in the window, from an agent or from another command, Ajour refuses:

```console
$ ajour undo
refused: That change can't be undone any more.
```

`ajour` keeps one Undo, the last one, in `last-undo` in your [state directory](/terminal/install#where-files-live). Each change replaces it, and `ajour undo` removes it once Ajour has answered. With nothing kept, it says `Nothing to undo from here.` When Ajour is out of reach, the Undo stays for another try.

## Submitted weeks

A [submitted week](/time/commit) is read-only from the terminal too. Ajour refuses a change to one of its entries with its reason, and the command exits 1:

```console
$ ajour add acme/backend -d 1h --on 11-02
refused: Week 45 is submitted. Reopen it in Ajour to change its entries.
```
