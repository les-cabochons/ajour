// An API 4 plugin that misbehaves on purpose, as each connection's mode
// asks: it answers, takes a second, never answers, or takes memory until
// Ajour closes it. The lifecycle check (#391) drives it.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Takes memory a megabyte at a time, touching every page, and holds it. */
async function balloon(megabytes) {
  const held = [];
  for (let index = 0; index < megabytes; index += 1) {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.fill((index % 250) + 1);
    held.push(chunk);
    if (index % 8 === 0) await sleep(1);
  }
  await sleep(60_000);
  return held.length;
}

export async function validateConnection(connection) {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}

export async function syncConnection(connection) {
  const mode = connection.config.mode;
  if (mode === "hang") await new Promise(() => undefined);
  if (mode === "slow") await sleep(1_000);
  if (mode === "balloon") await balloon(1_024);
  return { items: [] };
}

export async function hold({ ms }) {
  await sleep(ms);
  return ms;
}
