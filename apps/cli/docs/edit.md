ajour edit — change an entry

Usage: ajour edit ENTRY [TASK] [-m NOTE] [-d DURATION] [--json]

Changes an entry's task, note or time, as its form does in Ajour, and
prints its row:

     1:00  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov

-m "" clears the note.

A committed entry that no longer matches what Workday holds loses its
✓, and ajour says so on stderr:

     0:45  ACME  03 Meetings  Weekly sync, moved to 10:30  91c0aa3
  Now differs from what Workday holds. It shows as updated on the Commit page.

The running entry keeps running, and -d corrects its counted time: the
entry counts on from it, so a late start is fixed at once. 0 starts the
count over.

  ●  1:24  AJR  04 Review  PR #512, #514  3f9a2c1

ENTRY is running, last, or an id from ajour log or any unique prefix of
4 or more of its characters. TASK is PROJECT/TASK, TASK alone, or a
pinned key 1 to 0. See REFERENCES in ajour(1).

Options
  -m, --note NOTE           The new note. "" clears it.
  -d, --duration DURATION   The new time, such as 1:00 or 45m; for the
                            running entry, the counted time.
  --json                    The edit_entry tool's output, or
                            edit_running_entry's for the running entry.

Examples
  ajour edit b7e1d04 -d 1:00
  ajour edit last acme/meetings -m ""
  ajour edit running ajr/review -m "PR #512, #514"
  ajour edit running -d 1:00

Exit status
  0 on success, 1 when Ajour refuses, such as on a submitted week or when
  nothing runs, 2 when nothing is to change, 3 when Ajour is out of
  reach, 4 when ENTRY or TASK matches nothing or several. The candidates
  are listed.
