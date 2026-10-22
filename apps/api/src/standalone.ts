import { startAppApiServer } from "./server.ts";

// The local API run on its own, as `just api-start` does. The desktop app
// and the tests start it through `startAppApiServer` instead.
//
// It owns its process, so it records the process's crashes. It says on
// stderr where it listens: stdout carries the console sink's JSON lines.
// This line is the one console call the local API keeps, by decision.
const server = await startAppApiServer({ reportProcessCrashes: true });
const address = server.address();
if (address && typeof address === "object") {
  console.error(
    `Ajour app API listening on http://${address.address}:${address.port}`,
  );
}
