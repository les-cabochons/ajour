import type {
  PluginAuth,
  PluginAuthScheme,
  PluginHttpMethod,
  PluginNetwork,
  PluginStartMode,
} from "./plugin-api-4.ts";

/*
 * What a plugin reaches, read from its manifest, and what an update adds to
 * it. The Access section lists the summary, and consent on updates uses the
 * difference: an update widens access when it adds a capability, an auth
 * scheme, a host, a derived host, an endpoint, a public host, an MCP tool or
 * an agent prompt change, marks an access choice always on, adds an operation
 * to an access choice, or switches to "Always ready" (spec #381). Nothing else counts, removals included.
 */

export interface PluginAccessAuth {
  scheme: PluginAuthScheme;
  /** The connection fields the scheme reads, user field first. */
  fields: string[];
}

/** An address the connection saves, which the broker sends requests to. */
export interface PluginAccessHost {
  kind: "baseAddress" | "secretAddress";
  field: string;
}

/** One form of a derived host: a rule on the base host and what it builds. */
export interface PluginAccessDerivedHost {
  id: string;
  whenHost?: string;
  host: string;
  pathPrefix?: string;
  keepBasePath: boolean;
}

export interface PluginAccessEndpoint {
  /** `base`, or a derived host's id. */
  host: string;
  method: PluginHttpMethod;
  path: string;
  /** The access choice that unlocks it. */
  access?: string;
}

export interface PluginAccessMcpTool {
  task: string;
  tool: string;
}

export interface PluginAccessPrompt {
  task: string;
  /** The prompt's text, or a collision-resistant digest of it. */
  prompt: string;
}

/** An operation an access choice unlocks. */
export interface PluginAccessOperation {
  choice: string;
  operation: string;
}

export interface PluginAccessSummary {
  capabilities: string[];
  authSchemes: PluginAccessAuth[];
  hosts: PluginAccessHost[];
  derivedHosts: PluginAccessDerivedHost[];
  endpoints: PluginAccessEndpoint[];
  publicHosts: string[];
  mcpTools: PluginAccessMcpTool[];
  agentPrompts: PluginAccessPrompt[];
  /**
   * The access choices marked `always`, which are on without the user
   * turning them on, with their endpoints and operations.
   */
  alwaysOnAccess: string[];
  /** Every operation each access choice unlocks. */
  accessOperations: PluginAccessOperation[];
  startMode: PluginStartMode;
}

export interface PluginAccessDifference {
  capabilities: string[];
  authSchemes: PluginAccessAuth[];
  hosts: PluginAccessHost[];
  derivedHosts: PluginAccessDerivedHost[];
  endpoints: PluginAccessEndpoint[];
  publicHosts: string[];
  mcpTools: PluginAccessMcpTool[];
  /** Agent tasks whose prompt is new or changed. */
  agentPrompts: string[];
  /** Access choices that are now always on: new ones, or ones that were off by default. */
  alwaysOnAccess: string[];
  /** Operations an access choice now unlocks that it didn't before. */
  accessOperations: PluginAccessOperation[];
  /** The update switches the plugin to "Always ready". */
  alwaysReady: boolean;
}

/**
 * The manifest fields access reads. An API 3 manifest has no network and no
 * tools: it reaches nothing through the broker.
 */
export interface PluginAccessManifest {
  capabilities: Record<string, unknown> & {
    agentTask?: {
      tasks: readonly { id: string; tools?: readonly string[] }[];
    };
  };
  network?: PluginNetwork;
  connectionAccess?: readonly {
    id: string;
    always: boolean;
    operations?: readonly string[];
  }[];
  runtime?: { start: PluginStartMode };
}

function authOf(auth: PluginAuth): PluginAccessAuth {
  return {
    scheme: auth.scheme,
    fields:
      auth.scheme === "basic"
        ? [auth.userField, auth.secretField]
        : [auth.secretField],
  };
}

function byText<Item>(text: (item: Item) => string) {
  return (left: Item, right: Item) => {
    const a = text(left);
    const b = text(right);
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/**
 * What the manifest reaches. `agentPrompts` holds each agent task's prompt,
 * as read from the package, because the manifest holds only its path. A
 * missing one throws, so a prompt change can't go unseen.
 */
export function summarizePluginAccess(
  manifest: PluginAccessManifest,
  options: { agentPrompts: Readonly<Record<string, string>> },
): PluginAccessSummary {
  const network = manifest.network;
  const tasks = manifest.capabilities.agentTask?.tasks ?? [];
  const auth = network?.auth;
  const hosts: PluginAccessHost[] = [];
  if (auth?.scheme === "secretAddress") {
    hosts.push({ kind: "secretAddress", field: auth.secretField });
  }
  if (network?.baseAddress) {
    hosts.push({ kind: "baseAddress", field: network.baseAddress.field });
  }

  return {
    capabilities: Object.keys(manifest.capabilities)
      .filter((key) => manifest.capabilities[key] !== undefined)
      .sort(),
    authSchemes: auth ? [authOf(auth)] : [],
    hosts,
    derivedHosts: (network?.derivedHosts ?? [])
      .flatMap((host) =>
        host.forms.map((form) => ({
          id: host.id,
          ...(form.whenHost ? { whenHost: form.whenHost } : {}),
          host: form.host,
          ...(form.pathPrefix ? { pathPrefix: form.pathPrefix } : {}),
          keepBasePath: form.keepBasePath,
        })),
      )
      // Stable, so each host's forms keep their order, which decides the winner.
      .sort(byText((form) => form.id)),
    endpoints: [
      ...(network?.endpoints ?? []).map((endpoint) => ({
        host: "base",
        ...endpoint,
      })),
      ...(network?.derivedHosts ?? []).flatMap((host) =>
        host.endpoints.map((endpoint) => ({ host: host.id, ...endpoint })),
      ),
    ]
      .map(({ host, method, path, access }) => ({
        host,
        method,
        path,
        ...(access ? { access } : {}),
      }))
      .sort(byText(endpointKey)),
    publicHosts: [...(network?.publicHosts ?? [])].sort(),
    mcpTools: tasks
      .flatMap((task) =>
        (task.tools ?? []).map((tool) => ({ task: task.id, tool })),
      )
      .sort(byText(mcpToolKey)),
    agentPrompts: tasks
      .map((task) => {
        const prompt = options.agentPrompts[task.id];
        if (prompt === undefined) {
          throw new Error(`The prompt of agent task "${task.id}" is missing.`);
        }
        return { task: task.id, prompt };
      })
      .sort(byText((entry) => entry.task)),
    alwaysOnAccess: (manifest.connectionAccess ?? [])
      .filter((choice) => choice.always)
      .map((choice) => choice.id)
      .sort(),
    accessOperations: (manifest.connectionAccess ?? [])
      .flatMap((choice) =>
        (choice.operations ?? []).map((operation) => ({
          choice: choice.id,
          operation,
        })),
      )
      .sort(byText(accessOperationKey)),
    startMode: manifest.runtime?.start ?? "whenNeeded",
  };
}

function endpointKey(endpoint: PluginAccessEndpoint) {
  return [
    endpoint.host,
    endpoint.path,
    endpoint.method,
    endpoint.access ?? "",
  ].join("\u0000");
}

function mcpToolKey(entry: PluginAccessMcpTool) {
  return `${entry.task}\u0000${entry.tool}`;
}

function accessOperationKey(entry: PluginAccessOperation) {
  return `${entry.choice}\u0000${entry.operation}`;
}

function added<Item>(
  previous: readonly Item[],
  next: readonly Item[],
  key: (item: Item) => string,
) {
  const known = new Set(previous.map(key));
  return next.filter((item) => !known.has(key(item)));
}

const EMPTY_SUMMARY: PluginAccessSummary = {
  capabilities: [],
  authSchemes: [],
  hosts: [],
  derivedHosts: [],
  endpoints: [],
  publicHosts: [],
  mcpTools: [],
  agentPrompts: [],
  alwaysOnAccess: [],
  accessOperations: [],
  startMode: "whenNeeded",
};

/**
 * What `next` reaches that `previous` doesn't. Without a previous summary, as
 * for a first install, everything counts as added.
 */
export function pluginAccessDifference(
  previous: PluginAccessSummary | undefined,
  next: PluginAccessSummary,
): PluginAccessDifference {
  const before = previous ?? EMPTY_SUMMARY;
  const prompts = new Map(
    before.agentPrompts.map((entry) => [entry.task, entry.prompt] as const),
  );
  return {
    capabilities: added(before.capabilities, next.capabilities, String),
    authSchemes: added(before.authSchemes, next.authSchemes, (auth) =>
      [auth.scheme, ...auth.fields].join("\u0000"),
    ),
    hosts: added(
      before.hosts,
      next.hosts,
      (host) => `${host.kind}\u0000${host.field}`,
    ),
    derivedHosts: added(before.derivedHosts, next.derivedHosts, (form) =>
      [
        form.id,
        form.whenHost ?? "",
        form.host,
        form.pathPrefix ?? "",
        String(form.keepBasePath),
      ].join("\u0000"),
    ),
    endpoints: added(before.endpoints, next.endpoints, endpointKey),
    publicHosts: added(before.publicHosts, next.publicHosts, String),
    mcpTools: added(before.mcpTools, next.mcpTools, mcpToolKey),
    agentPrompts: next.agentPrompts
      .filter((entry) => prompts.get(entry.task) !== entry.prompt)
      .map((entry) => entry.task),
    alwaysOnAccess: added(before.alwaysOnAccess, next.alwaysOnAccess, String),
    accessOperations: added(
      before.accessOperations,
      next.accessOperations,
      accessOperationKey,
    ),
    alwaysReady:
      next.startMode === "alwaysReady" && before.startMode !== "alwaysReady",
  };
}

/** Whether an update needs the user's consent before it runs. */
export function widensAccess(difference: PluginAccessDifference) {
  return (
    difference.alwaysReady ||
    [
      difference.capabilities,
      difference.authSchemes,
      difference.hosts,
      difference.derivedHosts,
      difference.endpoints,
      difference.publicHosts,
      difference.mcpTools,
      difference.agentPrompts,
      difference.alwaysOnAccess,
      difference.accessOperations,
    ].some((items) => items.length > 0)
  );
}
