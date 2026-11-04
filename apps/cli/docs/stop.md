ajour stop — stop and save the running entry

Usage: ajour stop [--json]

Stops the running entry, as Stop does in Ajour, prints the saved row,
then today's total against the day's target:

     1:31  AJR  07 Export  Fix export rounding  3f9a2c1  saved
  Today 6:46 of 8:00

A day without a target shows the total alone.

Options
  --json   The stop_timer tool's output, with the saved entry.

Exit status
  0 on success, 1 when nothing runs, with Ajour's reason, 3 when Ajour is
  out of reach. Scripts that stop "if anything runs" use:

    ajour stop || true
