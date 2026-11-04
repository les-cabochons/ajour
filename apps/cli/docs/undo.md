ajour undo — undo the last change made from here

Usage: ajour undo [--json]

Presses the Undo of the last change this terminal made, as its toast in
Ajour would:

  Undid: Discarded the running entry

Each change from the terminal keeps its Undo in
$XDG_STATE_HOME/ajour/last-undo (~/.local/state/ajour/last-undo, or
%LOCALAPPDATA%\ajour\last-undo on Windows), readable by your user alone.
ajour undo reads it, asks Ajour, and once Ajour has answered removes it,
but only if it still holds the token it used: a change made from another
terminal while it runs keeps its own Undo for the next ajour undo. When
Ajour is out of reach, nothing is touched and the Undo is kept for another
try, as it is if ajour undo is stopped partway.

As in the app, only Ajour's last action can be undone, and only while
its toast shows: once you or anyone else changes something after it,
Ajour refuses, and the kept Undo is removed.

Options
  --json   The undo tool's output.

Exit status
  0 on success, 1 when there is nothing to undo from here or Ajour
  refuses, 3 when Ajour is out of reach.
