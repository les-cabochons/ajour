NAME
ajour dup - copy an entry

SYNOPSIS
ajour dup ENTRY [--to DAY] [--json]

DESCRIPTION
Copies an entry, as Duplicate does in Ajour, on its own day or, with
--to, on another, as Duplicate to… does. Prints the copy's row with its
day:

     0:45  ACME  03 Meetings  Weekly sync  f0a9d12  Fri 30 Oct

The copy is saved, even of a committed entry. The running entry can't be
copied: stop it first.

ENTRY is last, or an id from ajour log or any unique prefix of 4 or more
of its characters. DAY is today, yesterday, mon to sun, YYYY-MM-DD or
MM-DD. See REFERENCES in ajour(1).

OPTIONS
  --to DAY   The day to copy it to, its own day by default.

EXAMPLES
  ajour dup 91c0aa3 --to fri
  ajour dup last

EXIT STATUS
  0 on success, 1 when Ajour refuses, such as for the running entry or a
  submitted week, 2 for a bad DAY, 3 when Ajour is out of reach, 4 when
  ENTRY matches no entry or several. The candidates are listed.
