NAME
ajour discard - throw away the running entry's time

SYNOPSIS
ajour discard [--json]

DESCRIPTION
Discards the running entry, as Discard does in Ajour. An entry started
from nothing disappears; a continued entry keeps its saved time and
loses only the time since it last started.

  Discarded 0:04 on 07 Export. Undo with: ajour undo

OPTIONS
  Global options are described in ajour(1).

EXIT STATUS
  0 on success, 1 when nothing runs, with Ajour's reason, 3 when Ajour is
  out of reach.
EXAMPLES
  ajour discard
