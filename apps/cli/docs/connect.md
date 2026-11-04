ajour connect — pair the terminal with Ajour

Usage: ajour connect [--token-stdin]

In Ajour, open Settings › MCP, turn MCP on and create a client named
"Terminal". Ajour shows its token once. Paste it when asked; it is not
shown as you type.

The token is checked against the running Ajour first, then saved for your
user alone, in $XDG_CONFIG_HOME/ajour/token (~/.config/ajour/token, or
%APPDATA%\ajour\token on Windows). Nothing is saved when Ajour refuses it.

AJOUR_TOKEN, when set, is used instead of the saved token.

Options
  --token-stdin   Read the token from standard input, for a script or a
                  password manager:
                    pass show ajour | ajour connect --token-stdin
