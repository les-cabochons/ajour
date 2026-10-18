// What the docs screenshots need beyond the seeded workspace: the official
// plugins installed and connected, a desktop bridge that serves the plugin
// catalog, staged imports, and a few pull requests. Used by docs-shots.mjs.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  BUILT_IN_PLUGIN_CATALOG_ENTRIES,
} = require("../../apps/desktop/electron/plugin-catalog-seed.cjs");

// Copies of the official plugins' plugin.json files.
const manifests = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/plugin-manifests.json", import.meta.url),
    "utf8",
  ),
);

const HOUR = 3_600_000;

function connection(pluginId, id, label, tenantLabel, extra = {}) {
  const now = Date.now();
  return {
    id,
    pluginId,
    label,
    tenantLabel,
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: now - 30 * 24 * HOUR,
    // A recent sync keeps the auto-sync scheduler quiet during the capture.
    lastSyncAt: now - 4 * 60_000,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {},
    ...extra,
  };
}

/** The plugin overview with Azure DevOps, Jira and GitHub connected. */
export function pluginsOverview() {
  const plugins = [manifests.azure_devops, manifests.jira, manifests.github];
  return {
    pluginsEnabled: true,
    plugins,
    connectionGroups: [
      {
        plugin: manifests.azure_devops,
        enabled: true,
        connections: [
          connection("azure_devops", "ado-work", "Contoso", "Contoso", {
            pendingImportCount: 3,
            selectedImportCount: 2,
            configSummary: { organization: "contoso" },
            editableValues: {
              organizationUrl: "https://dev.azure.com/contoso",
              queryScope: "assigned_to_me",
              taskIconDisplayMode: "fallback",
              priorityFieldName: "Microsoft.VSTS.Common.Priority",
              priorityUrgent: "1",
              priorityHigh: "2",
              priorityMedium: "3",
              priorityLow: "4",
              originalEstimateFieldName:
                "Microsoft.VSTS.Scheduling.OriginalEstimate",
              remainingEstimateFieldName:
                "Microsoft.VSTS.Scheduling.RemainingWork",
              completedEstimateFieldName:
                "Microsoft.VSTS.Scheduling.CompletedWork",
            },
          }),
        ],
      },
      {
        plugin: manifests.jira,
        enabled: true,
        connections: [
          connection("jira", "jira-work", "Jira Cloud", "Contoso Jira", {
            configSummary: { site: "contoso.atlassian.net" },
            editableValues: {
              baseUrl: "https://contoso.atlassian.net",
              email: "sam@contoso.com",
              projectKey: "HRB",
              queryScope: "assigned_to_me",
              taskIconDisplayMode: "fallback",
            },
          }),
        ],
      },
      {
        plugin: manifests.github,
        enabled: true,
        connections: [
          connection("github", "gh-work", "Work", "Contoso on GitHub", {
            autoSync: true,
            autoSyncIntervalMinutes: 5,
            configSummary: { account: "sam-contoso", host: "github.com" },
            editableValues: {
              hostUrl: "https://github.com",
              include: "contoso",
              exclude: "",
              hideDrafts: false,
              includeTeamRequests: true,
            },
          }),
        ],
      },
    ],
    totalPendingImportCount: 3,
    totalSelectedImportCount: 2,
  };
}

/** Azure DevOps items waiting in Sync review. */
export function stagedImports() {
  const now = Date.now();
  const base = {
    source: "azure_devops",
    connectionId: "ado-work",
    connectionLabel: "Contoso",
    tenantLabel: "Contoso",
    projectName: "Atlas",
    pushedAt: now - 4 * 60_000,
  };
  const url = (id) =>
    `https://dev.azure.com/contoso/atlas/_workitems/edit/${id}`;
  const items = [
    {
      ...base,
      id: "azure_devops:ado-work:48350",
      sourceId: url(48350),
      sourceUrl: url(48350),
      externalId: "48350",
      title: "Timesheet export: support Workday columns",
      workItemType: "User Story",
      state: "New",
      priority: "high",
      originalEstimateHours: 8,
      remainingEstimateHours: 8,
      depth: 0,
      selectable: true,
      selected: true,
      childCount: 1,
    },
    {
      ...base,
      id: "azure_devops:ado-work:48351",
      sourceId: url(48351),
      sourceUrl: url(48351),
      externalId: "48351",
      title: "Map billable flag to the export",
      workItemType: "Task",
      state: "New",
      priority: "medium",
      remainingEstimateHours: 3,
      parentSourceId: url(48350),
      parentTitle: "Timesheet export: support Workday columns",
      depth: 1,
      selectable: true,
      selected: true,
      childCount: 0,
    },
    {
      ...base,
      id: "azure_devops:ado-work:48362",
      sourceId: url(48362),
      sourceUrl: url(48362),
      externalId: "48362",
      title: "Login page flickers on slow networks",
      workItemType: "Bug",
      state: "Active",
      priority: "urgent",
      remainingEstimateHours: 2,
      depth: 0,
      selectable: true,
      selected: false,
      childCount: 0,
    },
  ];
  return { items, totalCount: items.length, selectedCount: 2 };
}

/** Source states the plugins reported, for Settings › Workflow. */
export function sourceStatuses() {
  const now = Date.now();
  const ado = (label) => ({
    source: "azure_devops",
    connectionId: "ado-work",
    connectionLabel: "Contoso",
    tenantLabel: "Contoso",
    label,
    key: `azure_devops:ado-work:${label.toLowerCase()}`,
    lastSeenAt: now,
  });
  const jira = (label) => ({
    source: "jira",
    connectionId: "jira-work",
    connectionLabel: "Jira Cloud",
    tenantLabel: "Contoso Jira",
    label,
    key: `jira:jira-work:${label.toLowerCase()}`,
    lastSeenAt: now,
  });
  return {
    items: [
      ado("New"),
      ado("Active"),
      ado("Resolved"),
      ado("Closed"),
      jira("To Do"),
      jira("In Progress"),
      jira("Done"),
    ],
  };
}

/** The Azure DevOps states a settled item can move to. */
export const settleStates = () => ({
  states: [
    { name: "New", category: "Proposed", done: false },
    { name: "Active", category: "In Progress", done: false },
    { name: "Resolved", category: "Resolved", done: false },
    { name: "Closed", category: "Completed", done: true },
  ],
});

/** MCP settings with one client. Most shots turn MCP off, as it is by default. */
export const mcpSettings = (enabled = true) => ({
  enabled,
  clients: [
    {
      id: "client-1",
      name: "Claude Code on this Mac",
      createdAt: Date.now() - 6 * 24 * HOUR,
      lastUsedAt: Date.now() - 2 * HOUR,
    },
  ],
});

/**
 * A stand-in for the Electron preload bridge: enough for the Plugins page to
 * show the catalog and for General to show a finished update check.
 */
export function desktopBridgeScript() {
  return `(() => {
  const entries = ${JSON.stringify(BUILT_IN_PLUGIN_CATALOG_ENTRIES)};
  window.ajourDesktop = {
    runtime: { automaticUpdatesEnabled: false, developmentBuild: false, platform: "web", version: "1.4.0" },
    getPluginCatalog: async () => ({ entries, checkedAt: new Date().toISOString(), source: "network" }),
    getPluginCatalogSettings: async () => ({ refreshMinutes: 15 }),
    configurePluginCatalog: async (settings) => settings,
    onPluginCatalogUpdated: () => () => {},
    downloadCatalogPlugin: async () => { throw new Error("Not in screenshots"); },
    installPlugin: async () => null,
    uninstallPlugin: async () => { throw new Error("Not in screenshots"); },
    checkForUpdates: async (track) => ({ track, currentVersion: "1.4.0", latestVersion: "1.4.0", latestTag: "v1.4.0", releaseName: "Ajour 1.4.0", releaseUrl: "https://github.com/les-cabochons/ajour/releases", publishedAt: new Date().toISOString(), updateAvailable: false, checkedAt: new Date().toISOString() }),
    configureAutomaticUpdates: async () => {},
    openUpdateRelease: async () => {},
  };
})()`;
}

/**
 * Replaces EventSource with a stream that opens and stays quiet, so the agent
 * indicator reads "Agents idle" instead of failing to reach the mocked API.
 */
export function quietEventSourceScript() {
  return `(() => {
  window.EventSource = class extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      setTimeout(() => this.onopen?.(new Event("open")));
    }
    close() { this.readyState = 2; }
  };
})()`;
}

/**
 * Adds pull requests to the seeded workspace. Runs after the seed script,
 * which writes the workspace into localStorage.
 */
export function pullRequestsScript() {
  return `(() => {
  const key = "ajour.local-state.v2";
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const state = JSON.parse(raw);
  const now = Date.now();
  const min = 60000, hour = 3600000;
  const user = (login, displayName) => ({ login, displayName, isBot: false });
  const me = user("sam-contoso", "Sam Rivera");
  const pr = (id, repository, number, title, extra) => {
    const facts = {
      id: "PR_" + id, repository, number, title,
      url: "https://github.com/" + repository + "/pull/" + number,
      author: me, state: "open", draft: false,
      createdAt: now - 2 * 24 * hour, updatedAt: now - 20 * min,
      viewerIsAuthor: true, headSha: "a1b2c3d" + id, lastPushedAt: now - 3 * hour,
      reviewRequests: [], reviews: [], comments: [],
      checks: "success", mergeability: "mergeable",
      ...(extra.facts || {}),
    };
    return {
      _id: "pr-" + id, pluginId: "github", pluginName: "GitHub",
      connectionId: "gh-work", connectionLabel: "Work",
      viewerLogin: "sam-contoso", instanceUrl: "https://github.com",
      facts, status: "active", activeAt: now - hour, missingFromSync: false,
      ...extra.local,
    };
  };
  state.pullRequests = [
    pr("1", "contoso/atlas", 412, "Week grid: arrow keys move between cells", {
      facts: { author: user("jo-park", "Jo Park"), viewerIsAuthor: false,
        reviewRequests: [{ kind: "user", name: "sam-contoso", includesViewer: true }],
        checks: "pending" },
      local: { reason: "review-requested" },
    }),
    pr("2", "contoso/atlas", 409, "Fix export rounding on half-hour entries", {
      facts: { reviews: [{ id: "r1", author: user("jo-park", "Jo Park"), verdict: "changes_requested", submittedAt: now - 2 * hour }] },
      local: { reason: "new-review" },
    }),
    pr("3", "contoso/harbor", 88, "Offline sync conflict dialog", {
      facts: { author: user("lee-chen", "Lee Chen"), viewerIsAuthor: false,
        comments: [{ id: "c1", author: user("lee-chen", "Lee Chen"), createdAt: now - 40 * min, mentionsViewer: true }] },
      local: { reason: "mentioned" },
    }),
    pr("4", "contoso/atlas", 401, "Connector worker timeouts", {
      facts: { reviews: [{ id: "r2", author: user("jo-park", "Jo Park"), verdict: "approved", submittedAt: now - 5 * hour }] },
      local: { status: "settled", reason: "manual", lastActionAt: now - 4 * hour },
    }),
  ];
  localStorage.setItem(key, JSON.stringify(state));
})()`;
}
