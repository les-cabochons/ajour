ajour rm — delete entries

Usage: ajour rm ENTRY... [--json]

Deletes entries, as Delete does in Ajour, in one action with one Undo:

  Deleted 2 entries. Undo with: ajour undo

Every ENTRY is found before anything is deleted: one that matches no
entry, or several, deletes none. The running entry can't be deleted:
stop or discard it first. A committed entry's deletion shows on the
Commit page until Workday has it.

ENTRY is last, or an id from ajour log or any unique prefix of 4 or more
of its characters. See REFERENCES in ajour(1).

Options
  --json   The delete_entries tool's output.

Examples
  ajour rm f0a9d12 b7e1d04
  ajour rm last

Exit status
  0 on success, 1 when Ajour refuses, such as for the running entry or a
  submitted week, 2 without an ENTRY, 3 when Ajour is out of reach, 4
  when an ENTRY matches no entry or several. Nothing is deleted then.
