NAME
ajour completion - print shell completion

SYNOPSIS
ajour completion SHELL

DESCRIPTION
SHELL is bash, zsh or fish. Source the printed script in that shell.
Task names come from Ajour, cached privately for one minute.
An unreachable Ajour returns no candidates within about one second.

OPTIONS
  Global options are described in ajour(1).

EXAMPLES
  ajour completion bash > ~/.ajour.bash
