// A well-behaved API 4 plugin: it reaches its service only through
// `ajour.http`, and never sees its token.

async function call(connection, path) {
  const response = await ajour.http({
    connectionId: connection.id,
    method: "GET",
    path,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`The service answered ${response.status}.`);
  return await response.json();
}

export async function validateConnection(connection) {
  const me = await call(connection, "/api/me");
  return {
    normalizedConfig: connection.config,
    connectionSummary: { user: me.name },
  };
}

export async function syncConnection(connection) {
  const found = await call(connection, "/api/items");
  return {
    items: found.items.map((item) => ({
      source: "fixture-tracker",
      connectionId: connection.id,
      connectionLabel: connection.label,
      tenantLabel: connection.tenantLabel,
      sourceId: item.id,
      externalId: item.key,
      // What the plugin saw of its connection, so the check can tell it
      // never held the token.
      title: `${item.title} | ${Object.values(connection.config).join(",").slice(0, 200)}`,
      workItemType: "Task",
      depth: 0,
    })),
  };
}

/** Where the check reads which process the plugin's code ran in. */
export function whoAmI() {
  return {
    origin: self.location.origin,
    hasWindow: typeof window !== "undefined",
    hasRequire: typeof require !== "undefined",
    hasProcess: typeof process !== "undefined",
    hasAjour: typeof ajour === "object",
  };
}
