// A small backlog plugin written against the SDK, as a plugin repo would.
// It reaches its service only through `ajour.http`.
import type {} from "../../globals.ts";
import type {
  PluginConnection,
  PluginManifest,
  PluginModule,
} from "../../index.ts";

export const manifest: PluginManifest = {
  id: "ajc-sample",
  version: "4.0.0",
  apiVersion: 4,
  displayName: "Sample tracker",
  iconSvg: "<svg viewBox='0 0 16 16' />",
  entrypoint: "dist/index.js",
  connectionFields: [
    { id: "baseUrl", label: "Site URL", type: "url", required: true },
    { id: "email", label: "Email", type: "text", required: true },
    {
      id: "apiToken",
      label: "API token",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  capabilities: { connector: {} },
  network: {
    auth: { scheme: "basic", userField: "email", secretField: "apiToken" },
    baseAddress: { field: "baseUrl" },
    endpoints: [
      { method: "GET", path: "/rest/api/3/myself" },
      { method: "POST", path: "/rest/api/3/search/jql" },
    ],
    requestHeaders: ["Accept", "Content-Type"],
  },
};

interface SearchAnswer {
  issues: { key: string; fields: { summary: string; issuetype: string } }[];
}

async function search(connection: PluginConnection, jql: string) {
  const response = await ajour.http({
    connectionId: connection.id,
    method: "POST",
    path: "/rest/api/3/search/jql",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jql, fields: ["summary", "issuetype"] }),
  });
  if (!response.ok) {
    throw new Error(`The search failed with status ${response.status}.`);
  }
  return await response.json<SearchAnswer>();
}

export const plugin: PluginModule = {
  async validateConnection(connection) {
    const response = await ajour.http({
      connectionId: connection.id,
      method: "GET",
      path: "/rest/api/3/myself",
    });
    if (response.status === 401) throw new Error("The token was rejected.");
    const me = await response.json<{ displayName: string }>();
    return {
      normalizedConfig: connection.config,
      connectionSummary: { user: me.displayName },
    };
  },

  async syncConnection(connection) {
    const answer = await search(connection, "assignee = currentUser()");
    ajour.log("info", "Synced issues", { count: answer.issues.length });
    return {
      items: answer.issues.map((issue) => ({
        source: connection.pluginId,
        connectionId: connection.id,
        connectionLabel: connection.label,
        tenantLabel: connection.tenantLabel,
        sourceId: issue.key,
        externalId: issue.key,
        title: issue.fields.summary,
        workItemType: issue.fields.issuetype,
        depth: 0,
      })),
    };
  },
};
