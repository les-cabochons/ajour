ajour edit — change the running entry

Usage: ajour edit running [TASK] [-m NOTE] [-d DURATION] [--json]

Changes the running entry's task, note or counted time, as its form does
in Ajour. It keeps running, and the row shows it:

  ●  1:24  AJR  04 Review  PR #512, #514  3f9a2c1

-d corrects the counted time: the entry counts on from it, so a late
start is fixed at once. 0 starts the count over.

Saved entries are edited in Ajour for now.

TASK is PROJECT/TASK, TASK alone, or a pinned key 1 to 0. See REFERENCES
in ajour(1).

Options
  -m, --note NOTE           The new note.
  -d, --duration DURATION   The counted time, such as 1:00 or 45m.
  --json                    The edit_running_entry tool's output.

Examples
  ajour edit running ajr/review -m "PR #512, #514"
  ajour edit running -d 1:00

Exit status
  0 on success, 1 when nothing runs, with Ajour's reason, 2 when nothing
  is to change, 3 when Ajour is out of reach, 4 when TASK matches no task
  or several.
