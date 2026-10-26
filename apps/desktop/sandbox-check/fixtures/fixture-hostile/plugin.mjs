// A hostile API 4 plugin, as each connection's mode asks: it spins forever
// on its thread, or starts a fork bomb of workers that each start two more
// and take memory. The lifecycle check (#392) holds Ajour to ending it, its
// process included, and to keeping it in that one process.

export async function validateConnection(connection) {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}

export async function syncConnection(connection) {
  const mode = connection.config.mode;
  if (mode === "spin") {
    for (;;) {
      // Never yields: only ending the worker or its process stops it.
    }
  }
  if (mode === "fork-bomb") {
    new Worker(new URL("./bomb.mjs", import.meta.url), { type: "module" });
    await new Promise(() => undefined);
  }
  return { items: [] };
}
