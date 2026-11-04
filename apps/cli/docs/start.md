NAME
ajour start - start an entry today

SYNOPSIS
ajour start [TASK] [-m NOTE] [-d DURATION] [--json]

DESCRIPTION
Starts an entry on today, as Start entry does in Ajour, and prints its
row:

  ●  0:20  AJR  07 Export  Fix export rounding  3f9a2c1

With an entry running, that entry is saved first and the new one starts
at the same instant, without a prompt: a Switch. The saved row comes
first:

     1:28  ACME  05 Backend   Rate limiter retries  c41ee90  saved
  ●  0:00  ACME  03 Meetings  Weekly sync           91c0aa3

Without a TASK it starts an empty entry, as S does in the app, and says
how to name it later:

  ●  0:00  —  —  Untitled entry  7a20b1c
  Set its task with: ajour edit running TASK

TASK is PROJECT/TASK, TASK alone, or a pinned key 1 to 0. See REFERENCES
in ajour(1).

OPTIONS
  -m, --note NOTE           The entry's note.
  -d, --duration DURATION   Count on from this time, for a late start,
                            such as 0:20 or 20m.

EXAMPLES
  ajour start acme/backend -m "Rate limiter retries"
  ajour start 1                    the task pinned to key 1
  ajour start export -d 0:20       started 20 minutes ago

EXIT STATUS
  0 on success, 1 when Ajour refuses, such as on a submitted week, 2 for
  a bad option, 3 when Ajour is out of reach, 4 when TASK matches no
  task or several. The candidates are listed.
