# Ajour CLI

Run from the repository with `just cli --help`.

`corepack pnpm --filter @ajour/cli build` checks types and generates every
manual page in `dist/man/man1/`. Install that directory's `.1` files in the
platform's man1 directory. The generated pages need no runtime dependency.

The source pages in `docs/*.md` are literal, hand-aligned text. Uppercase
section headings delimit NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXAMPLES and
shared sections. Command `--help` selects SYNOPSIS, OPTIONS and EXAMPLES;
the root card reads the same synopses. Document global options in `ajour.md`.
The manual contract test checks pages against the parser in both directions.

The release bundle embeds every source page through `resources.ts`. Archives
include the generated pages at `man/man1/`. Live completion runs the hidden
`__task-candidates` command in a child of the same executable. Development
invokes `task-candidates.ts` through Node; the SEA binary invokes itself without Node
flags or source files. The parent terminates the lookup after 900 ms; the test terminal allows 10 s, because a host running the whole suite starts the child slowly.

The general unit suite skips the real-shell tests. To run them on a POSIX host
with python3 and the shells installed, use
`AJOUR_SHELL_TESTS=1 corepack pnpm --filter @ajour/cli exec vitest run src/completion-shells.test.ts`.
Set `AJOUR_TEST_SHELL=/bin/bash` to check a specific executable.

The dedicated completion workflow checks bash, zsh and fish on Linux, plus
macOS system bash 3.2 and Homebrew bash when available. Its PTY driver presses
Tab and Enter and checks literal argument insertion. The fake helper supplies
task names; CLI integration tests cover the real API and cache.
