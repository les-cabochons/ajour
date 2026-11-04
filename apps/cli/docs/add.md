ajour add — save an entry without running it

Usage: ajour add TASK -d DURATION [-m NOTE] [--on DAY] [--json]

Saves an entry, as Save in Ajour's entry editor does, without starting
anything. A forgotten hour lands on the day it belongs to, and the row
names that day when it isn't today:

     0:45  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov

TASK is PROJECT/TASK, TASK alone, or a pinned key 1 to 0. DAY is today
by default. See REFERENCES in ajour(1).

Options
  -d, --duration DURATION   The entry's time, such as 45m or 1:30.
                            Required.
  -m, --note NOTE           The entry's note.
  --on DAY                  The day to save it on: today, yesterday,
                            mon to sun, YYYY-MM-DD or MM-DD.
  --json                    The create_entry tool's output.

Examples
  ajour add ajr/review -d 45m -m "PR #512" --on yesterday
  ajour add 1 -d 0:30              the task pinned to key 1, today
  ajour add backend -d 2h --on 10-12

Exit status
  0 on success, 1 when Ajour refuses, such as on a submitted week, 2 for
  a missing TASK or DURATION or a bad value, 3 when Ajour is out of
  reach, 4 when TASK matches no task or several. The candidates are
  listed.
