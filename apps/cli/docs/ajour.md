ajour — record time on project tasks, from the terminal

Usage: ajour [options] <command> [args]

Running entry
  status [-s] [-w]        What is running, and today's total.

Setup
  connect                 Pair with the Ajour app on this machine.
  help [COMMAND]          Show a command's manual page.

Options
  --json             Machine output, the same shapes as Ajour's MCP tools.
  --color WHEN       auto (default), always or never. NO_COLOR is honored.
  -q, --quiet        No messages on success.
  -V, --version      Print the version.
  -h, --help         Show this help, or a command's.

Exit status
  0  Done.
  1  Ajour refused the action, with its own reason.
  2  A bad command, option or value.
  3  Ajour is not reachable: not running, MCP off, or the token was revoked.

Environment
  AJOUR_TOKEN        The client token, instead of the saved one.
  AJOUR_URL          Ajour's local address, http://127.0.0.1:8787 by default.
  NO_COLOR, CLICOLOR_FORCE

Run 'ajour help <command>' for details.
