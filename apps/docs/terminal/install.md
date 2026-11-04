# Install and connect

`ajour` is one file. Node is built into it, so there is nothing else to install. It needs the [Ajour desktop app](/start/install) running on the same machine.

## Download

Each [release](https://github.com/les-cabochons/ajour/releases) has a CLI archive per platform, beside the app's installers:

| Platform              | File                                 |
| --------------------- | ------------------------------------ |
| Linux (x64)           | `ajour-<version>-linux-x64.tar.gz`   |
| macOS (Apple silicon) | `ajour-<version>-macos-arm64.tar.gz` |
| macOS (Intel)         | `ajour-<version>-macos-x64.tar.gz`   |
| Windows (x64)         | `ajour-<version>-windows-x64.zip`    |

Take the archive from the same release as your Ajour app. Each archive holds three things, with no folder around them:

```
ajour          the command (ajour.exe on Windows)
man/man1/      the manual: ajour.1, and one page per command
completions/   ajour.bash, _ajour and ajour.fish
```

## Linux and macOS

Extract the archive into a folder of its own, and link the command into a folder on your PATH. On macOS, use the `macos-arm64` or `macos-x64` archive in place of `linux-x64`.

```sh
version=0.0.1-nightly.20261104.294
curl -fLO "https://github.com/les-cabochons/ajour/releases/download/v$version/ajour-$version-linux-x64.tar.gz"
mkdir -p ~/.local/share/ajour ~/.local/bin
tar -xzf "ajour-$version-linux-x64.tar.gz" -C ~/.local/share/ajour
ln -sf ~/.local/share/ajour/ajour ~/.local/bin/ajour
```

If `~/.local/bin` isn't on your PATH yet, add it in `~/.bashrc` or `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

In fish, run `fish_add_path ~/.local/bin` once.

To read the manual with `man ajour`, add the archive's `man` folder to MANPATH in the same file. The trailing colon keeps the system's pages:

```sh
export MANPATH="$HOME/.local/share/ajour/man:$MANPATH"
```

[Shell setup](/terminal/shell) loads the completion files.

## Windows

In PowerShell, extract the archive and add its folder to your user Path:

```powershell
Expand-Archive .\ajour-<version>-windows-x64.zip "$HOME\ajour-cli"
$path = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$path;$HOME\ajour-cli", "User")
```

You can also add the folder in **Edit environment variables for your account**. `ajour` works in PowerShell, Command Prompt and Git Bash.

## Check it

Open a new terminal and run `ajour -V`. It prints its own version, and the app's once you are connected and Ajour runs:

```console
$ ajour -V
ajour 0.0.1-nightly.20261104.294
Ajour 0.0.1-nightly.20261104.294
```

## Connect

The terminal is an [agent client](/app/agents) of Ajour, with its own token. Create it once per machine:

1. In Ajour, open **Settings › MCP** and turn on **Allow agents**.
2. Under **Clients**, type `Terminal` and press **Add client**. Ajour shows the token once.
3. Run `ajour connect` and paste the token. It doesn't show as you type.

```console
$ ajour connect
In Ajour, open Settings › MCP, turn MCP on and create a client named "Terminal".
Paste its token:
Connected to Ajour on http://127.0.0.1:8787. The token is saved in /home/you/.config/ajour/token.
```

`ajour connect` checks the token with Ajour before it saves anything. If Ajour refuses it, nothing is saved and the command exits 3 with `Ajour doesn't accept this token.`

To pass the token without the prompt, from a password manager or a file, use `--token-stdin`:

```sh
pass show ajour | ajour connect --token-stdin
ajour connect --token-stdin < token.txt
```

**Revoke** on the Terminal client, in Settings › MCP, cuts the terminal off at once. Create a new client and run `ajour connect` again to come back.

### Environment variables

`AJOUR_TOKEN` is used in place of the saved token, for one command or a whole session:

```sh
AJOUR_TOKEN="$(pass show ajour)" ajour log week
```

`AJOUR_URL` is Ajour's local address, `http://127.0.0.1:8787` by default. Set it only when your Ajour listens on another port.

## Where files live

`ajour` keeps three small files, each readable by your user alone. On Linux and macOS it follows the XDG base directories. On Windows, a set XDG variable wins too.

| File                                                               | Linux and macOS                                                          | Windows                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------- |
| The token                                                          | `$XDG_CONFIG_HOME/ajour/token`, else `~/.config/ajour/token`             | `%APPDATA%\ajour\token`                 |
| The last change's Undo, for [`ajour undo`](/terminal/entries#undo) | `$XDG_STATE_HOME/ajour/last-undo`, else `~/.local/state/ajour/last-undo` | `%LOCALAPPDATA%\ajour\last-undo`        |
| Task names for completion, kept one minute                         | `$XDG_CACHE_HOME/ajour/tasks.json`, else `~/.cache/ajour/tasks.json`     | `%LOCALAPPDATA%\ajour\cache\tasks.json` |

Your entries are never among them: they stay in Ajour.

## Update

Download the new release's archive and extract it over the old folder. On Linux and macOS, the link in `~/.local/bin` keeps working.

Keep the command and the app on the same release. When the app is older than the command, a command the app doesn't know yet stops with:

```
error: Update Ajour to use this command.
```

[Update the app](/start/install#updates), then run the command again.

## When Ajour is out of reach

These messages exit 3. A write can still have gone through just before Ajour went out of reach: see [Exit codes](/terminal/scripting#exit-codes) before you retry one.

| Message                                                                         | What to do                                                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Ajour isn't running. Start Ajour, then try again.`                             | Start Ajour. Turn on **Keep Ajour running when the window closes** to keep it running.             |
| `MCP is off. Turn it on in Ajour under Settings › MCP.`                         | Turn on **Allow agents** in Settings › MCP.                                                        |
| `Not connected to Ajour. Run: ajour connect`                                    | No token is saved and `AJOUR_TOKEN` is empty. Run `ajour connect`.                                 |
| `Ajour doesn't accept this token. It may have been revoked. Run: ajour connect` | The client was revoked. Create a new one and run `ajour connect`.                                  |
| `Open the Ajour window to use this tool.`                                       | Ajour runs, but no window is loaded to answer. Open Ajour from the tray, the menu bar or the Dock. |
| `Update Ajour to use this command.`                                             | The app is older than the command. Update the app.                                                 |

## Uninstall

Delete the folder you extracted, the link in `~/.local/bin`, and the three files above. Then revoke the Terminal client in **Settings › MCP**.
