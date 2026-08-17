# QA routine: Local workspace smoke

- ID: QA-001
- Owner: TBD
- Last verified: Never

## Purpose

Confirm that a tester can open the local daily time workspace and reach its primary actions without an account or connector credentials.

## Prerequisites

- Node.js 22+, Corepack, and `just` are installed.
- Project dependencies have been installed with `just install`.
- Chromium acceptance-test support has been installed with `just acceptance-install`.
- Port `4173` is available.
- Use an isolated browser profile or clear site data for `http://127.0.0.1:4173`.

## Test data

- No account, connector credentials, projects, or time entries are required.

## Procedure

1. Start the web app with `just start --port 4173`.
   - Expected: The terminal reports that the app is available at `http://127.0.0.1:4173`.
2. Open `http://127.0.0.1:4173/time/today` in a browser.
   - Expected: The daily time workspace loads without asking for account credentials.
3. Find the desktop primary navigation sidebar.
   - Expected: The tinted sidebar reaches the top and bottom of the window, `Time`, `Backlog`, and `Projects` are visible near the top, `Settings` is aligned to the bottom, and `Time` is the current page.
   - On Windows, the timer controls do not sit beneath minimize, maximize, or close. On macOS, the traffic lights occupy the reserved strip above the sidebar brand and navigation.
4. Find the `Submit timesheet` action.
   - Expected: The action is visible and enabled. On a window wider than 1640px, the day labels remain centered in a 1440px column while the day color band, table header background, and row separators stretch to both workspace edges without an enclosing outer border.
5. Open Settings from the sidebar.
   - Expected: The primary sidebar is replaced by the Settings section list, with a `Back` action aligned to the bottom.
6. Select `Back`.
   - Expected: The previous workspace and primary sidebar return.
7. Open Projects.
   - Expected: The primary sidebar remains visible beside a fully expanded Projects sidebar; the Projects sidebar begins directly at the primary sidebar edge, the detail pane is left-aligned after it, and project labels are not collapsed to icons.
   - At a width between 641px and 1023px, both sidebars remain available as 48px icon rails; project actions and archived projects remain reachable.
8. Open Backlog.
   - Expected: The Backlog header background and row separators meet both workspace edges, their labels remain centered in the 1440px content column on very wide windows, the surface fills the available height, and there is no rounded outer card.

## Cleanup

- Stop the development server.
- Clear site data for `http://127.0.0.1:4173` if the isolated profile will be reused.

## Evidence

- Capture one screenshot showing the full-height Time workspace sidebar, unobstructed native window controls, and the `Submit` action.
- Capture one screenshot showing the Settings sidebar replacement and bottom `Back` action.
- Record any browser console error that blocks the routine.

## Result

- Status: Not run
- Notes:
