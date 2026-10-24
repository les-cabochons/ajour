import { startAppApiServer } from "./server.ts";
import { createWindowToken } from "./window-token.ts";

// The local API run on its own, as `just api-start` and the web dev server
// do. The desktop app and the tests start it through `startAppApiServer`
// instead.
//
// The window token comes from whoever started this process, as the web dev
// server passes it in AJOUR_APP_API_WINDOW_TOKEN. It leaves the environment
// at once. Without one, the API makes its own and tells nobody, so `/api`
// answers no caller but `/api/health`: scripts and agents use `/mcp`.
//
// It owns its process, so it records the process's crashes. It says on
// stderr where it listens: stdout carries the console sink's JSON lines.
// These lines are the only console calls the local API keeps, by decision.
const givenWindowToken = process.env.AJOUR_APP_API_WINDOW_TOKEN;
delete process.env.AJOUR_APP_API_WINDOW_TOKEN;
const server = await startAppApiServer({
  reportProcessCrashes: true,
  windowToken: givenWindowToken || createWindowToken(),
});
const address = server.address();
if (address && typeof address === "object") {
  console.error(
    `Ajour app API listening on http://${address.address}:${address.port}`,
  );
}
if (!givenWindowToken) {
  console.error(
    "No window token was given, so /api answers only /api/health. Run `just start` for the web app.",
  );
}
