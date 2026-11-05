# Install and connect

`ajour` is one file. Node is built into it, so there is nothing else to install. It needs the [Ajour desktop app](/start/install) running on the same machine.

## Install from Ajour

On Windows and macOS, Ajour installs the command for you:

1. In Ajour, open **Settings › General**. Under **Terminal**, press **Install** on the **ajour command** row.
2. Ajour downloads the command of its own version from its release, checks it against the checksum GitHub publishes, and installs it. On Windows, it adds `%LOCALAPPDATA%\Ajour\bin` to your user Path with no administrator prompt. On macOS, it adds the link described below.
3. Open a new terminal: one opened before doesn't see the new Path. Then [check it](#check-it) and [connect](#connect).

The row then shows the version and its folder, which also holds `man` and `completions` for [Shell setup](/terminal/shell). When an install fails, the row says why, and nothing changes.

On macOS, Ajour uses `~/Library/Application Support/Ajour/bin/` and links `/usr/local/bin/ajour` to the command. It checks the signature belongs to Ajour before running it. Ajour asks for your password when `/usr/local/bin` needs administrator access. Cancelling installs nothing. An existing command from another source stays untouched.

If the link goes missing, Ajour repairs it at launch only when no password is needed. Otherwise Settings shows the reason and **Retry**, which can ask for your password.

The command updates with Ajour. After an app update, Ajour downloads and checks the matching command in the background. If the download fails, the installed version keeps working and Settings shows the reason with **Retry**.

On Linux, install from the archive below.

Press **Remove** in Settings to take the command off your PATH and delete its install folder. There is no confirmation dialog. The row says "Removing ajour…", then "Not installed." Errors appear inline with **Retry**. Your CLI connection token and Undo state stay on your computer. On macOS, removal may ask for your password. Cancelling leaves everything installed.

Uninstalling Ajour on Windows removes the command too. An app update keeps it. On macOS, dragging Ajour to the Trash leaves the command and its `/usr/local/bin/ajour` link behind. Use Remove before deleting the app. If the command folder is gone and the link dangles, delete the link with `sudo rm /usr/local/bin/ajour`.

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

[Install from Ajour](#install-from-ajour) does this for you. To do it by hand, extract the archive in PowerShell and add its folder to your user Path:

```powershell
Expand-Archive .\ajour-<version>-windows-x64.zip "$HOME\ajour-cli"
$path = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$path;$HOME\ajour-cli", "User")
```

You can also add the folder in **Edit environment variables for your account**. `ajour` works in PowerShell, Command Prompt and Git Bash.

## WSL

With the `ajour` command installed from Ajour on Windows, **Settings › General › Terminal** lists your WSL distros under **ajour command**. Press **Add** next to a distro. Ajour downloads the Linux build of its own version into `%LOCALAPPDATA%\Ajour\bin\linux`, checks it inside that distro, and links `~/.local/bin/ajour` to it. Docker Desktop's distros aren't listed.

Add needs WSL 2. The Linux `ajour` can't start in WSL 1 yet ([#611](https://github.com/les-cabochons/ajour/issues/611)), so a WSL 1 distro shows "WSL 1 isn't supported." with no **Add**. To use it, convert the distro to WSL 2 in **Windows PowerShell**, replacing `Ubuntu` with its name, then reopen Settings:

```powershell
wsl --set-version Ubuntu 2
```

Open a new terminal in that distro, then pair it once. Each distro keeps its own token:

```sh
ajour connect
ajour status
```

`ajour` in WSL reaches the Windows app through `ajour.exe`, so it works with WSL's default NAT networking and with mirrored networking alike. Nothing in `.wslconfig` changes.

If Settings says to add `~/.local/bin` to your PATH, add it in your shell's profile, as in [Linux and macOS](#linux-and-macos). Ubuntu and Debian add it on their own once the folder exists. If something else is already at `~/.local/bin/ajour`, Ajour leaves it there and says so. Remove it, then press **Add** again.

Removing the `ajour` command deletes the Linux build too, and leaves each distro's `~/.local/bin/ajour` link pointing at nothing. Delete it there with `rm ~/.local/bin/ajour`.

### Install the archive by hand

Without Add, run the Linux CLI inside WSL and keep the Windows Ajour app running. Follow the [Linux installation steps](#linux-and-macos) in your WSL terminal, using the `linux-x64` archive from the same release as the Windows app. This archive requires an x64 distribution on WSL 2, as it can't start in WSL 1 yet ([#611](https://github.com/les-cabochons/ajour/issues/611)).

The CLI connects to the Windows app at `http://127.0.0.1:8787`. Use [mirrored networking](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking) so WSL can reach that Windows loopback address. It requires Windows 11 22H2 or newer and a current WSL installation.

1. In Windows, open `%USERPROFILE%\.wslconfig`, or create it if it does not exist. Add the following setting. If the file already has a `[wsl2]` section, add or update `networkingMode` in that section and keep the other settings:

   ```ini
   [wsl2]
   networkingMode=mirrored
   ```

2. Save your work in every WSL distribution, then run this in **Windows PowerShell**. It stops all running WSL distributions:

   ```powershell
   wsl --shutdown
   ```

3. Reopen your WSL terminal. In the Windows Ajour app, open **Settings › MCP**, turn on **Allow agents**, and add a client named `WSL terminal`. Copy the token shown once.
4. In **WSL**, pair the CLI and check the connection:

   ```sh
   ajour connect
   ajour status
   ```

Paste the token when `ajour connect` asks for it. WSL saves its own token under `$XDG_CONFIG_HOME/ajour/token`, or `~/.config/ajour/token` by default. Leave `AJOUR_URL` unset to use `http://127.0.0.1:8787`.

If Ajour is out of reach, check that the Windows app is running, **Allow agents** is on, and WSL restarted after the networking change. WSL 2's default NAT mode cannot reach Ajour through the Windows host IP because Ajour listens on loopback. Changing `AJOUR_URL` to that IP alone does not fix the connection.

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
