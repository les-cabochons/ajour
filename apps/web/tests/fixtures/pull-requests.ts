import type {
  CodeHostPullRequestFacts,
  ConnectorsOverview,
} from "@ajour/shared";

export const pullRequestFacts: CodeHostPullRequestFacts = {
  id: "pr1",
  repository: "acme/api",
  number: 1,
  url: "https://github.com/acme/api/pull/1",
  title: "Fix request handling",
  author: { login: "author", isBot: false },
  viewerIsAuthor: false,
  state: "open",
  draft: false,
  headSha: "one",
  lastPushedAt: 100,
  createdAt: 50,
  updatedAt: 100,
  reviewRequests: [{ kind: "user", name: "alex", includesViewer: true }],
  reviewRequestEvents: [],
  reviews: [],
  comments: [],
  checks: "success",
  mergeability: "mergeable",
};

export const codeHostOverview: ConnectorsOverview = {
  pluginsEnabled: true,
  plugins: [],
  connectionGroups: [
    {
      plugin: {
        id: "github",
        version: "0.1.0",
        apiVersion: 3,
        displayName: "GitHub",
        iconSvg: "<svg />",
        entrypoint: "plugin.mjs",
        capabilities: { codeHost: {} },
        connectionFields: [
          {
            id: "token",
            label: "Token",
            type: "password",
            required: true,
            secret: true,
          },
        ],
      },
      enabled: true,
      connections: [
        {
          id: "work",
          pluginId: "github",
          label: "Work",
          tenantLabel: "GitHub",
          connectedAt: 1,
          autoSync: false,
          autoSyncIntervalMinutes: 5,
          lastSyncAt: 1,
          pendingImportCount: 0,
          selectedImportCount: 0,
          configSummary: {},
          editableValues: {},
        },
      ],
    },
  ],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
};
codeHostOverview.plugins = codeHostOverview.connectionGroups.map(
  (group) => group.plugin,
);
