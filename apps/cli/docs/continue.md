ajour continue — count more time on an entry

Usage: ajour continue [ENTRY] [--json]

Continues an entry, as Continue does in Ajour. Today's entry resumes
with its saved time:

  ●  1:31  AJR  07 Export  Fix export rounding  3f9a2c1

Another day's entry is left as it is, and a new entry starts today with
its task and note:

  ●  0:00  ACME  05 Backend  Rate limiter retries  e91c4b7
  Started a new entry today with Monday's task and note.

Without an ENTRY it continues last: the entry saved most recently in the
past week. An entry that runs is saved first, as in a Switch.

ENTRY is an id from ajour log or any unique prefix of 4 or more of its
characters, or last. See REFERENCES in ajour(1).

Options
  --json   The continue_entry tool's output.

Exit status
  0 on success, 1 when Ajour refuses, such as for the running entry, 2
  for an ENTRY that isn't one, 3 when Ajour is out of reach, 4 when ENTRY
  matches no entry or several. The candidates are listed.
