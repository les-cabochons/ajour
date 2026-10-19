// What the docs screenshots need beyond the seeded workspace: the official
// plugins installed and connected, a desktop bridge that serves the plugin
// catalog, staged imports, comments, calendar events and a few pull
// requests. Used by docs-shots.mjs.
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

/**
 * The time of every shot: a Thursday afternoon, so the seeded week is full
 * whatever day the shots are taken. docs-shots.mjs sets the browser clock to
 * it, and the fixtures below use it instead of the real clock.
 */
export const NOW = new Date(2026, 9, 15, 14, 30).getTime();

function connection(pluginId, id, label, tenantLabel, extra = {}) {
  const now = NOW;
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

/** The ICS calendar plugin and its connection, for the calendar shots. */
const calendarGroup = () => ({
  plugin: manifests.ics,
  enabled: true,
  connections: [
    connection("ics", "ics-work", "Work calendar", "Outlook", {
      configSummary: {},
      editableValues: { email: "sam@contoso.com" },
    }),
  ],
});

/**
 * The plugin overview with Azure DevOps, Jira and GitHub connected. With
 * `calendar`, the ICS calendar plugin is connected too.
 */
export function pluginsOverview({ calendar = false } = {}) {
  const plugins = [manifests.azure_devops, manifests.jira, manifests.github];
  const overview = {
    pluginsEnabled: true,
    plugins,
    connectionGroups: [
      {
        plugin: manifests.azure_devops,
        enabled: true,
        // Pull requests come from GitHub in these shots.
        inactiveCapabilities: ["codeHost"],
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
        // The backlog comes from Azure DevOps and Jira in these shots.
        inactiveCapabilities: ["connector"],
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
  if (calendar) {
    overview.plugins.push(manifests.ics);
    overview.connectionGroups.push(calendarGroup());
  }
  return overview;
}

/** Azure DevOps items waiting in Sync review. */
export function stagedImports() {
  const now = NOW;
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
  const now = NOW;
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
      createdAt: NOW - 6 * 24 * HOUR,
      lastUsedAt: NOW - 2 * HOUR,
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
  const now = ${NOW};
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

const sam = { id: "sam", displayName: "Sam Rivera", email: "sam@contoso.com" };
const jo = { id: "jo", displayName: "Jo Park", email: "jo.park@contoso.com" };
const lee = {
  id: "lee",
  displayName: "Lee Chen",
  email: "lee.chen@contoso.com",
};
const joanna = {
  id: "joanna",
  displayName: "Joanna Brooks",
  email: "joanna.brooks@contoso.com",
};

/** The comments of the synced backlog items, as Azure DevOps returns them. */
export function itemComments() {
  const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();
  return {
    viewer: sam,
    total: 4,
    comments: [
      {
        id: "c1",
        author: jo,
        body: "Arrow keys should wrap to the next row at the end of a week, like a spreadsheet.",
        createdAt: at(30),
      },
      {
        id: "c2",
        author: sam,
        body: "Agreed. Tab moves to the next cell, and Enter edits the hours.",
        createdAt: at(28),
        reactions: [{ reaction: "like", count: 2, viewerReacted: false }],
      },
      {
        id: "c3",
        author: lee,
        body: "[@Sam Rivera](mention:sam) the grid loses focus after a paste. Can you check it before the release?",
        createdAt: at(2),
        updatedAt: at(1.5),
      },
      {
        id: "c4",
        author: jo,
        body: "Pairing on it this afternoon.",
        createdAt: at(1),
        reactions: [{ reaction: "heart", count: 1, viewerReacted: true }],
      },
    ],
  };
}

/** The people the @ suggestions offer for "jo". */
export const itemPeople = () => ({ people: [jo, joanna] });

/** A week of meetings in the ICS calendar, around the fixed Thursday. */
export function calendarEvents() {
  const at = (day, hour, minute = 0) =>
    new Date(2026, 9, day, hour, minute).getTime();
  const meeting = (eventId, title, day, from, to, extra = {}) => ({
    eventId,
    title,
    startsAt: at(day, ...from),
    endsAt: at(day, ...to),
    allDay: false,
    status: "confirmed",
    response: "accepted",
    busy: true,
    ...extra,
  });
  const harborSync = (day) =>
    meeting(`harbor-sync-${day}`, "Harbor sync", day, [10], [10, 30], {
      seriesId: "harbor-sync",
    });
  return {
    events: [
      harborSync(12),
      meeting("security", "Security training", 13, [11], [12]),
      meeting("demo-prep", "Atlas demo prep", 14, [15], [15, 30]),
      harborSync(15),
      meeting("lunch", "Lunch", 15, [12], [13], { busy: false }),
      meeting("design-review", "Design review: settings icons", 15, [13], [14]),
      {
        ...meeting("freeze", "Release freeze", 15, [0], [0]),
        endsAt: at(16, 0),
        allDay: true,
        busy: false,
      },
      meeting("go-no-go", "Release 1.4 go/no-go", 16, [10], [10, 45]),
    ],
  };
}

/**
 * What the user did before the shots: Ajour remembers the project of the
 * Harbor sync, and the Week grid item was opened before its last comments.
 * Runs after the seed script.
 */
export function rememberedScript() {
  return `(() => {
  const key = "ajour.local-state.v2";
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const state = JSON.parse(raw);
  const now = ${NOW};
  state.calendarEventRules = [{ _id: "rule-harbor-sync", pluginId: "ics", connectionId: "ics-work", seriesId: "harbor-sync", label: "Harbor sync", action: "assign", projectId: "p-harbor", taskId: "t-harbor-dev", createdAt: now - 7 * 24 * 3600000 }];
  localStorage.setItem(key, JSON.stringify(state));
  localStorage.setItem("ajour.comments-seen", JSON.stringify({ w2: now - 3 * 3600000 }));
})()`;
}
