ajour — record time on project tasks, from the terminal

Usage: ajour [options] <command> [args]

Running entry
  start [TASK] [-m NOTE] [-d DURATION]        Start an entry today. Switches if one runs.
  stop                                        Stop and save the running entry.
  discard                                     Throw away the time counted since it started.
  continue [ENTRY]                            Count more time on an entry (default: last).
  edit running [TASK] [-m NOTE] [-d DURATION] Change the running entry. It keeps running.
  undo                                        Undo the last change made from here.
  status [-s] [-w]                            What is running, and today's total.

Saved entries
  add TASK -d DURATION [-m NOTE] [--on DAY]   Save an entry without running it.
  edit ENTRY [TASK] [-m NOTE] [-d DURATION]   Change an entry. -m "" clears the note.
  move ENTRY --to DAY                         Move an entry to another day.
  dup ENTRY [--to DAY]                        Copy an entry, on its day or another.
  rm ENTRY...                                 Delete entries, in one action.

Prints
  log [RANGE] [-s] [--by task] [--format FORMAT]
                          A day, several days or a week: a table on a
                          terminal, tab-separated values in a pipe.

Setup
  connect                 Pair with the Ajour app on this machine.
  help [COMMAND]          Show a command's manual page.

Options
  --json             Machine output, the same shapes as Ajour's MCP tools.
  --color WHEN       auto (default), always or never. NO_COLOR is honored.
  -q, --quiet        Print nothing when a change succeeds.
  -V, --version      Print the version.
  -h, --help         Show this help, or a command's.

References
  TASK       PROJECT/TASK or TASK. PROJECT matches a code, a name or a
             full name; TASK a task name. Matching ignores case and accents, and
             takes an exact name, then a prefix, then any part of the
             name. Exactly one active task must match, else exit 4 with
             the candidates. A digit 1 to 0 is the task pinned to that key.
  ENTRY      An id from ajour log, or any unique prefix of 4 or more of
             its characters; running for the running entry; last for the
             entry saved or edited most recently, on any day. Several
             matches exit 4 with their rows.
  DURATION   1:30, 1h30, 2h, 90m, 1.5 or 1,5. Whole minutes, up to 24
             hours.
  DAY        today, yesterday, mon to sun (the most recent, today
             included), 2026-11-03, or 11-03 in this year.
  RANGE      A DAY, DAY..DAY with both days included, week or last-week
             (Monday to Sunday), or an ISO week such as 2026-W45. At most
             62 days.

Rules
  The terminal does what the app does, with the app's rules. A running
  entry is always on today. Starting while one runs saves it first and
  starts the new one at the same instant. Ajour's refusals are printed
  as they are, after "refused:". Every change shows its Undo toast in
  Ajour, and ajour undo presses it.

Output
  Writes print the entry's row: ● when it runs, its time, project code,
  task, note, ✓ when Workday holds it as it is, its id, and its day when
  it isn't today. Rows are cut to the terminal's width; in a pipe they
  are whole and without color. Messages go to stderr. ajour log prints
  tab-separated values in a pipe, with ISO dates and decimal hours.

Exit status
  0  Done.
  1  Ajour refused the action, with its own reason.
  2  A bad command, option or value.
  3  Ajour is not reachable: not running, MCP off, or the token was revoked.
  4  A reference matched nothing or several things.

Environment
  AJOUR_TOKEN        The client token, instead of the saved one.
  AJOUR_URL          Ajour's local address, http://127.0.0.1:8787 by default.
  XDG_STATE_HOME     Where the last change's Undo is kept, in ajour/last-undo.
  NO_COLOR, CLICOLOR_FORCE

Run 'ajour help <command>' for details.
