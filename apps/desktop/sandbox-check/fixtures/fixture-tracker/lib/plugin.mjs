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
  const version = await ajour.process.run({ command: "version", args: {} });
  if (version.exitCode !== 0 || !/^v\d+\./.test(version.stdout))
    throw new Error("The process broker did not return a Node version.");
  try {
    await ajour.process.run({ executable: "node", argv: ["--version"] });
    throw new Error("An undeclared process escaped.");
  } catch (error) {
    if (error.name !== "AjourProcessError" || error.code !== "user_denied")
      throw error;
  }
  for (const url of [
    "other://private",
    "file:///private",
    "javascript:alert(1)",
  ]) {
    try {
      await ajour.open(url);
      throw new Error("An undeclared link escaped.");
    } catch (error) {
      if (error.name !== "AjourProcessError" || error.code !== "undeclared")
        throw error;
    }
  }
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
