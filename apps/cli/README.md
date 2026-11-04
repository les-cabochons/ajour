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

Release packaging in #541 must include the pages, the source manual used by
fallback help, and the `task-candidates.ts` worker beside the CLI modules,
or compile that worker as a separate Node entry point. The completion helper
runs it using the same Node executable and terminates it after 900 ms.

`python3 apps/cli/scripts/check-completion.py`, from the repository root, exercises an actual Tab key
in bash, zsh and fish. CI installs those shells on Linux. The fake helper
supplies task names; CLI integration tests cover the real API and cache.
