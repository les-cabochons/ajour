ajour status — what is running, and today's total

Usage: ajour status [-s [--idle TEXT]] [-w] [--json]

Shows the running entry with its time counted to the second, its project
and task, when it started counting, and today's total:

  ● 1:24:07  Fix export rounding
    AJR · 07 Export · since 13:20 · today 6:39

With nothing running, it names the entry saved last, on any day:

  ○ Nothing running · today 5:15 · last: 04 Review, 45m ago

Each line is cut to the terminal's width; nothing wraps.

Options
  -s, --short     One line for a status bar, such as "● 1:24 Fix export
                  rounding". When nothing runs it prints the --idle text, or
                  nothing. It never prints an error: while Ajour is out of
                  reach it prints nothing and exits 0. No color unless
                  --color always.
  --idle TEXT     What --short prints when nothing runs. Empty by default.
  -w, --watch     Redraw each second until q or Ctrl-C. Ajour is asked again
                  every ten seconds. With --short it prints a new line each
                  second instead, for bars that read a stream (waybar,
                  polybar's tail), and an empty line while Ajour is out of
                  reach.
  --json          The get_running_timer tool's output.

Examples
  tmux:      set -g status-right '#(ajour status -s)'
  starship:  [custom.ajour]
             command = "ajour status -s"
             when = true
