import type {
  BacklogComment,
  BacklogListItemCommentsResult,
  BacklogSyncResult,
  PluginsOverview,
} from "@ajour/shared";

/** The fixture's synced Backlog parent comes from this plugin and connection. */
export const commentsOverview: PluginsOverview = {
  pluginsEnabled: true,
  plugins: [],
  connectionGroups: [
    {
      plugin: {
        id: "example",
        version: "0.1.0",
        apiVersion: 3,
        displayName: "Example",
        iconSvg: "<svg />",
        entrypoint: "plugin.mjs",
        capabilities: {
          connector: {
            comments: {
              edit: true,
              delete: true,
              reactions: ["like", "heart"],
              mentions: true,
            },
          },
        },
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
          id: "fixture",
          pluginId: "example",
          label: "Work",
          tenantLabel: "Contoso",
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
commentsOverview.plugins = commentsOverview.connectionGroups.map(
  (group) => group.plugin,
);

const ana = { id: "ana", displayName: "Ana Silva" };
const marc = { id: "marc", displayName: "Marc Dubois" };
const me = { id: "me", displayName: "Alex" };

/** The user last saw the thread between the old comments and the new ones. */
export const commentsSeenAt = Date.parse("2026-10-15T00:00:00Z");

export const fixtureComments: BacklogComment[] = [
  {
    id: "c1",
    author: ana,
    body: "First comment",
    createdAt: "2026-10-10T09:00:00Z",
  },
  {
    id: "c2",
    author: marc,
    body: "Second comment",
    createdAt: "2026-10-11T09:00:00Z",
  },
  {
    id: "c3",
    author: ana,
    body: "Third comment",
    createdAt: "2026-10-12T09:00:00Z",
  },
  {
    id: "c4",
    author: marc,
    body: "Fourth comment",
    createdAt: "2026-10-13T09:00:00Z",
  },
  {
    id: "c5",
    author: me,
    body: "Yes. [@Ana Silva](mention:ana) should the code come first?",
    createdAt: "2026-10-16T09:00:00Z",
  },
  {
    id: "c6",
    author: ana,
    body: "Before the task name, please.",
    createdAt: "2026-10-16T10:42:00Z",
    updatedAt: "2026-10-16T11:00:00Z",
    reactions: [{ reaction: "like", count: 2, viewerReacted: true }],
  },
  {
    id: "c7",
    author: marc,
    body: "Seventh comment",
    createdAt: "2026-10-17T09:00:00Z",
  },
];

/** The newest five, then the two before them. */
export function fixtureCommentPage(
  cursor: string | undefined,
): BacklogListItemCommentsResult {
  return cursor === "earlier"
    ? { viewer: me, comments: fixtureComments.slice(0, 2), total: 7 }
    : {
        viewer: me,
        comments: fixtureComments.slice(2),
        total: 7,
        earlierCursor: "earlier",
      };
}

/** The Backlog parent was settled the morning before Ana's comment. */
export const parentSettledAt = Date.parse("2026-10-18T09:00:00Z");

/** The same connection, syncing on its own, so the app syncs it at launch. */
export const autoSyncOverview: PluginsOverview = {
  ...commentsOverview,
  connectionGroups: commentsOverview.connectionGroups.map((group) => ({
    ...group,
    connections: group.connections.map((connection) => ({
      ...connection,
      autoSync: true,
    })),
  })),
};

/** A sync that reports Ana's comment on the settled parent, and nothing else. */
export const syncWithAnaComment: BacklogSyncResult = {
  connection: commentsOverview.connectionGroups[0]!.connections[0]!,
  mode: "review",
  items: [],
  stagedCount: 0,
  updatedCount: 0,
  skippedCount: 0,
  workItemUpdates: [],
  doneItems: [],
  viewer: me,
  commentFacts: [
    {
      localWorkItemId: "parent",
      comments: [
        { id: "c10", author: me, createdAt: "2026-10-18T09:30:00Z" },
        { id: "c11", author: ana, createdAt: "2026-10-18T10:00:00Z" },
      ],
    },
  ],
};
