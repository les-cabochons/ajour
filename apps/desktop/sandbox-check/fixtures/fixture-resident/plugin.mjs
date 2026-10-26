// An "Always ready" API 4 plugin: Ajour starts it without a call and keeps
// it open. The lifecycle check (#391) reads its renderer.

export async function validateConnection(connection) {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}

export async function syncConnection() {
  return { items: [] };
}

export async function hold({ ms }) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
}
