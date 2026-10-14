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
   - Expected: The tinted sidebar reaches the top and bottom of the window, the timer dock reads `Nothing running`, `Time`, `Backlog`, and `Projects` are visible below it with their counts, `Settings` is aligned to the bottom, and `Time` is the current page.
   - On Windows, the timer controls do not sit beneath minimize, maximize, or close. On macOS, the traffic lights occupy the reserved strip above the sidebar brand and navigation.
4. Find the `Submit week` action.
   - Expected: The action is visible and enabled. On a window wider than 1640px, the day labels remain centered in a 1440px column while the day color band, table header background, and row separators stretch to both workspace edges without an enclosing outer border.
5. Open Settings from the sidebar.
   - Expected: The settings pages replace the primary sidebar in the full-height left column, grouped under App, Work and Data, with `Back to app` at the top. A running entry floats at the bottom of that column. `Back to app` returns to the page you came from.
6. Start an entry with Start in the titlebar, close its editor, select `Hide sidebar` next to the logo, reload, then press Cmd+B (Ctrl+B outside macOS).
   - Expected: The timer dock shows the running entry and the window title starts with `●`. Hiding the sidebar leaves `Show sidebar` at the start of the titlebar and the running entry floating at the bottom left. The sidebar stays hidden after the reload and shows again with the shortcut. Narrowing the window below 1100px hides it; `Show sidebar` then opens it over the page, and widening the window restores the expanded sidebar.
7. Open Projects.
   - Expected: The primary sidebar remains visible beside a fully expanded Projects sidebar; the Projects sidebar begins directly at the primary sidebar edge, the detail pane is left-aligned after it, and project labels are not collapsed to icons.
   - At a width between 768px and 1099px, the primary sidebar is hidden and the Projects sidebar is a 48px rail; project actions and archived projects remain reachable.
8. Open Backlog.
   - Expected: The Backlog header background and row separators meet both workspace edges, their labels remain centered in the 1440px content column on very wide windows, the surface fills the available height, and there is no rounded outer card.

## Cleanup

- Stop the development server.
- Clear site data for `http://127.0.0.1:4173` if the isolated profile will be reused.

## Evidence

- Capture one screenshot showing the full-height Time workspace sidebar, unobstructed native window controls, and the `Submit week` action.
- Capture one screenshot showing the Settings sidebar replacement and bottom `Back` action.
- Record any browser console error that blocks the routine.

## Result

- Status: Not run
- Notes:
