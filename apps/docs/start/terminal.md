# Terminal

The `ajour` command connects to your running Ajour app. Closing its window keeps it available when "Keep Ajour running when the window closes" is on.

## Install

Download the CLI archive beside the installers on the [releases page](https://github.com/les-cabochons/ajour/releases). Choose `windows-x64`, `macos-arm64` for Apple silicon, `macos-x64` for Intel, or `linux-x64`. The version in the filename matches the release. Node is included in the binary, so you do not need to install Node.

Extract the archive. On macOS or Linux, put `ajour` in `~/.local/bin` and add that directory to your shell's PATH. On Windows, put `ajour.exe` in a directory such as `%USERPROFILE%\bin` and add it to your user Path in Environment Variables. Open a new terminal and run `ajour -V`.

## Connect

Start Ajour. In Settings > MCP, enable MCP and create a client named "Terminal". Run `ajour connect` and paste its token at the hidden prompt. The CLI stores it in your user configuration directory. `AJOUR_TOKEN` overrides it and `AJOUR_URL` overrides the default local API address.

```sh
ajour start PROJECT/TASK -m "Review the release"
ajour status
ajour stop
ajour log
ajour undo
```

Writes use the same rules and Undo as the window. If a command says "Update Ajour to use this command.", install the matching Ajour release. `ajour -V` also prints the connected app's version when the server reports one.

## Completion and manual

On releases that include shell completion, load your shell's script:

```sh
# Bash, in ~/.bashrc
eval "$(ajour completion bash)"
# Zsh, after compinit in ~/.zshrc
source <(ajour completion zsh)
# Fish, in ~/.config/fish/config.fish
ajour completion fish | source
```

If your archive includes `man/` and `completions/`, you can install those files alongside the binary. Copy the man pages into `~/.local/share/man/man1/` and add `~/.local/share/man` to MANPATH if needed. `ajour --help` works without installing man pages.

## tmux

Add this to `~/.tmux.conf` to refresh the running entry every 15 seconds. Idle or unreachable Ajour leaves the segment empty.

```tmux
set -g status-interval 15
set -g status-right '#(ajour status -s --idle "" 2>/dev/null)'
```

## Starship

Add this to `~/.config/starship.toml`, and include `$custom` in your prompt format:

```toml
[custom.ajour]
command = 'ajour status -s --idle "" 2>/dev/null'
when = 'command -v ajour >/dev/null 2>&1'
format = '[$output]($style) '
style = 'green'
```
