NAME
ajour move - move an entry to another day

SYNOPSIS
ajour move ENTRY --to DAY [--json]

DESCRIPTION
Moves an entry to another day, as Move to… does in Ajour, and prints its
row with the day it landed on:

     0:45  AJR  04 Review  PR #512  b7e1d04  Mon 2 Nov

The running entry can't move: stop it first.

ENTRY is last, or an id from ajour log or any unique prefix of 4 or more
of its characters. DAY is today, yesterday, mon to sun, YYYY-MM-DD or
MM-DD. See REFERENCES in ajour(1).

OPTIONS
  --to DAY   The day to move it to. Required.

EXAMPLES
  ajour move b7e1d04 --to mon
  ajour move last --to 2026-10-30

EXIT STATUS
  0 on success, 1 when Ajour refuses, such as for the running entry or a
  submitted week, 2 without --to or for a bad DAY, 3 when Ajour is out of
  reach, 4 when ENTRY matches no entry or several. The candidates are
  listed.
