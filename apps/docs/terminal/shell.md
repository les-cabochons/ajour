# Shell setup

Completion, the manual, and the running entry in tmux, your prompt or your status bar.

## Completion

`ajour` completes its commands, their options, the day words (`today`, `yesterday`, `mon` to `sun`, `week`, `last-week`) and `running` and `last`. After `start`, `add` and `edit`, it completes task names as `PROJECT/TASK`:

```console
$ ajour start AJR/<Tab>
AJR/04\ Review   AJR/07\ Export   AJR/09\ Admin
```

Task names come from Ajour and are kept for one minute in your [cache directory](/terminal/install#where-files-live). When Ajour is out of reach, no task name is offered, within about a second, and the rest still completes.

`ajour completion SHELL` prints the script for `bash`, `zsh` or `fish`. The archive has the same scripts in `completions/`. Loading the printed script always matches the `ajour` you run. A copied file needs copying again after an update, but saves running `ajour` each time a shell starts.

### bash

In `~/.bashrc`:

```sh
eval "$(ajour completion bash)"
```

Or, with the bash-completion package, which loads a command's completion on first use:

```sh
mkdir -p ~/.local/share/bash-completion/completions
ajour completion bash > ~/.local/share/bash-completion/completions/ajour
```

### zsh

In `~/.zshrc`, after `compinit`:

```sh
source <(ajour completion zsh)
```

Or source the archive's file there: `source ~/.local/share/ajour/completions/_ajour`.

### fish

fish loads a command's completion from `~/.config/fish/completions` on first use:

```sh
ajour completion fish > ~/.config/fish/completions/ajour.fish
```

## The manual

Each command has a page: what it does, its options, examples and its exit status.

- `ajour --help` lists every command on one screen.
- `ajour log --help` prints the command's synopsis, options and examples.
- `ajour help log` opens the whole page: `man ajour-log` when the pages are installed, else your `$PAGER`, `less -R` by default. In a pipe it prints plain text, so `ajour help log | grep -A8 RANGE` works.
- `man ajour` and `man ajour-log` work once the archive's `man` folder is on your MANPATH. See [Install](/terminal/install#linux-and-macos).

## tmux

Show the running entry on the right of the status line:

```sh
set -g status-interval 15
set -g status-right '#(ajour status -s)'
```

It reads `● 1:24 Fix export rounding`. When nothing runs it shows nothing, or the text you give to `--idle`:

```sh
set -g status-right '#(ajour status -s --idle "○ idle")'
```

`ajour status -s` never prints an error, and exits 0 when Ajour is out of reach, so the status line stays clean.

## Starship

In `~/.config/starship.toml`:

```toml
[custom.ajour]
command = "ajour status -s"
when = true
format = "[$output]($style) "
style = "green"
```

If you set your own `format`, add `${custom.ajour}` to it. Starship runs the command before each prompt.

## Status bars

With `-s`, `-w` prints a new line each second, instead of running once. Bars that read a stream update on each line. It asks Ajour every ten seconds and counts on in between, and prints an empty line while Ajour is out of reach.

Waybar, in `~/.config/waybar/config`:

```json
"custom/ajour": {
  "exec": "ajour status -s -w",
  "format": "{}"
}
```

Polybar:

```ini
[module/ajour]
type = custom/script
exec = ajour status -s -w
tail = true
```

## Aliases

Short names for what you type every day:

```sh
alias aj='ajour'
alias ajl='ajour log'
alias ajw='ajour log week'
alias ajd='ajour log last-week --format workday | wl-copy'
```

In bash, give an alias of `ajour` its completion too:

```sh
complete -F _ajour_complete aj
```

In fish, an abbreviation expands as you type, so completion keeps working:

```sh
abbr -a aj ajour
abbr -a ajw ajour log week
```

For a task picker that starts what you choose, see [Pick a task with fzf](/terminal/scripting#pick-a-task-with-fzf).
