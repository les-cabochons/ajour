# QA routine: UI capture and performance budgets

- ID: QA-002
- Owner: TBD
- Last verified: 2026-10-14

## Purpose

Give every UI change a before and after: screenshots of each product surface on one seeded workspace, and the renderer measurements the performance budgets in `docs/agents/code-standards.md` come from.

## Prerequisites

- `just install` and `just acceptance-install` have run (Playwright Chromium).
- Port `4173` is free, or a dev server already runs there.

## Procedure

1. On the base branch, run `just ui-capture` and `just ui-perf`. Keep the printed numbers and copy `qa/ui/out` aside.
   - Expected: `qa/ui/out` holds light, dark, hidden-sidebar, 1000px and 420px captures of Time, Backlog, Projects, Settings, Commit, the entry editor, the palette and the menus.
2. On the change, run both again.
3. Put the before and after screenshots of each changed surface in the pull request, and the two sets of numbers.
   - Expected: none of the four measurements is more than 10% worse than the base branch. The dev server serves unbundled modules and React's development build, so the numbers sit well above the production figures in `docs/agents/code-standards.md` (cold load about 150ms, Start click about 40ms, store write about 75ms, 4ms per second with a timer running); only the comparison between the two runs counts.
   - Reference, 2026-10-14, Windows, dev mode, after the foundation: cold load 1.82s, Start click 67ms, store write 30ms, 53ms per second with a timer running (script 35ms, style 5ms, layout 3ms).

## Notes

- The scripts start the web app in test mode on 4173 and mock the app API, so no desktop runtime is needed. To measure the base branch, start its dev server on another port (`--port 4174 --strictPort --mode test`) and run `AJOUR_QA_PORT=4174 just ui-perf` from the change's checkout.
- Warm the server first: run once with `AJOUR_PERF_RUNS=1` and discard it, then measure. Stop other browsers and servers; a second dev server or a test run on the same machine inflates every number.
- `AJOUR_PERF_RUNS` sets how many runs feed each median (default 5). Compare runs on the same machine only.
- `qa/ui/out` is ignored by git. Screenshots belong in the pull request, not the repository.
