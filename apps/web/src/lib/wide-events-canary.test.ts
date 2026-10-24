import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import os from "node:os";
import path from "node:path";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  FetchEventSource,
  fetchAsTheApp,
  startLocalApi,
  waitForEvent,
  type TestPlugin,
} from "@/test-support/local-api";

/*
 * The privacy canary (#311, ADR 0011). Every kind of content carries one
 * marker: notes, titles, descriptions, comment bodies, names, URLs, paths and
 * secrets, from the user, from a source tool through its plugin and from an
 * agent. Representative flows then run through the renderer's store, its jobs
 * and its local API client, into the real local API and its plugin worker.
 * No event of any runtime may hold the marker, in a key or a value, except
 * an error's message, which ADR 0011 lets keep what a plugin echoes (see
 * MARKER_ALLOWED_IN). A plugin that echoes the connection's secret or URL in
 * its error still leaves none: the message is scrubbed before it enters an
 * event, and so are the home and user data folders. A leak is fixed where the
 * event is built, never here.
 */

/** In every piece of content. Spot it in a failure's output. */
const MARKER = "CANARY-LEAK-7Q4X";
const MARKED = /canary-leak-7q4x/i;
const SECRET = `tok-${MARKER}-secret`;
const SITE = `https://${MARKER.toLowerCase()}.example.test/${MARKER}`;

/**
 * A tracker with every capability whose content an event could pick up:
 * synced items with descriptions, settles, comments, mentions and calendar
 * events, all of them marked. A connection whose token ends in `-revoked`
 * fails, echoing the token and the site in its error, as a careless plugin
 * would; one whose token ends in `-garbled` answers what breaks the
 * contract.
 */
const canaryPlugin: TestPlugin = {
  id: "canary",
  displayName: "Canary tracker",
  capabilities: {
    connector: {
      settle: true,
      comments: {
        edit: true,
        delete: true,
        reactions: ["like"],
        mentions: true,
      },
      description: { write: true },
    },
    calendar: {},
    codeHost: {},
    team: { apiVersion: 1 },
  },
  connectionFields: [
    { id: "label", label: "Label", type: "text", required: true },
    { id: "tenantLabel", label: "Site", type: "text", required: true },
    { id: "siteUrl", label: "Site URL", type: "url", required: true },
    {
      id: "token",
      label: "Token",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  source: `
const MARKER = ${JSON.stringify(MARKER)};
const person = { id: "person-" + MARKER, displayName: "Ana " + MARKER, email: MARKER + "@example.test" };
function check(connection) {
  const { token, siteUrl } = connection.config;
  if (token.endsWith("-revoked")) {
    throw new Error("The tracker refused " + token + " at " + siteUrl + "/rest/api");
  }
}
export async function validateConnection(config) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function syncConnection(connection) {
  check(connection);
  if (connection.config.token.endsWith("-garbled")) {
    return { items: [{ title: "Garbled " + MARKER, sourceId: MARKER }] };
  }
  return {
    items: [{
      source: "canary", connectionId: connection.id,
      connectionLabel: connection.label, tenantLabel: connection.tenantLabel,
      sourceId: MARKER + "-1", externalId: MARKER + "-1",
      sourceUrl: connection.config.siteUrl + "/browse/" + MARKER + "-1",
      title: "Title " + MARKER, note: "Note " + MARKER,
      description: { text: "Description " + MARKER },
      projectName: "Project " + MARKER, workItemType: "Story " + MARKER,
      state: "State " + MARKER, assignedTo: "Ana " + MARKER,
      depth: 0, selectable: true, childCount: 0,
    }],
    workItemUpdates: [],
  };
}
export async function listSettleStates(connection) {
  check(connection);
  return { states: [{ name: "Done " + MARKER, category: "Done " + MARKER, done: true }] };
}
export async function writeSettle(connection, request) {
  check(connection);
  return { state: request.state, stateCategory: "Done " + MARKER, stateDone: true };
}
export async function readDescription(connection) {
  check(connection);
  return { description: { text: "Description " + MARKER } };
}
export async function writeDescription(connection, request) {
  check(connection);
  return { outcome: "written", description: { text: request.text } };
}
export async function listItemComments(connection) {
  check(connection);
  return {
    viewer: person,
    comments: [{ id: "comment-" + MARKER, author: person, body: "Body " + MARKER, createdAt: "2026-10-13T10:00:00Z" }],
    total: 1,
  };
}
export async function postItemComment(connection, request) {
  check(connection);
  if (request.body.includes("refuse me")) {
    throw new Error("Could not post with " + connection.config.token);
  }
  if (request.body.includes("no such issue")) {
    throw new Error("Issue " + MARKER + "-9 not found");
  }
  return { comment: { id: "comment-" + MARKER + "-2", author: person, body: request.body, createdAt: "2026-10-17T10:00:00Z" } };
}
export async function editItemComment(connection, request) {
  check(connection);
  return { comment: { id: request.commentId, author: person, body: request.body, createdAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T11:00:00Z" } };
}
export async function deleteItemComment(connection) {
  check(connection);
  return {};
}
export async function setItemCommentReaction(connection, request) {
  check(connection);
  return { reactions: [{ reaction: request.reaction, count: 1, viewerReacted: true }] };
}
export async function searchItemPeople(connection, request) {
  check(connection);
  return { people: [{ ...person, displayName: person.displayName + request.query }] };
}
export async function listCalendarEvents(connection, request) {
  check(connection);
  const day = Date.parse(request.from + "T00:00:00Z");
  return {
    events: [{
      eventId: "event-" + MARKER, seriesId: "series-" + MARKER,
      startsAt: day + 9 * 3600000, endsAt: day + 10 * 3600000, allDay: false,
      title: "Meeting " + MARKER, status: "confirmed", response: "accepted",
      busy: true, isOrganizer: true,
    }],
  };
}
const REPOSITORY = "acme-" + MARKER + "/api";
const CHANGED_PATH = "src/" + MARKER + "/secret.ts";
const user = { login: "ana-" + MARKER, displayName: "Ana " + MARKER, isBot: false };
function summary(number) {
  return {
    repository: REPOSITORY, number, id: "pr-" + MARKER + "-" + number,
    url: "https://git.example.test/" + REPOSITORY + "/pull/" + number,
    title: "Title " + MARKER, author: user, state: "open", draft: false,
    createdAt: 1760000000000, updatedAt: 1760000100000,
  };
}
export async function syncPullRequests(connection) {
  check(connection);
  return {
    viewer: user, instanceUrl: "https://git.example.test",
    pullRequests: [{
      ...summary(7), viewerIsAuthor: false, headSha: "sha7", lastPushedAt: 1760000050000,
      reviewRequests: [{ kind: "user", name: "Ana " + MARKER, includesViewer: true }],
      reviews: [], comments: [{ id: "c-" + MARKER, author: user, createdAt: 1760000060000, mentionsViewer: false }],
      checks: "success", mergeability: "mergeable",
    }],
  };
}
export async function getPullRequestContent(connection) {
  check(connection);
  return {
    headSha: "sha7", baseSha: "base7",
    files: [{ path: CHANGED_PATH, status: "modified", additions: 1, deletions: 0, patch: "+ Patch " + MARKER, binary: false }],
  };
}
export async function getFileContent(connection, request) {
  check(connection);
  if (request.sha === "missing") {
    throw new Error("Cannot read " + request.path + " in " + request.repository);
  }
  if (request.sha === "local") {
    throw new Error("ENOENT: no such file or directory, open '" + request.path + "'");
  }
  return { kind: "text", content: "File " + MARKER };
}
export async function getPullRequestConversation(connection) {
  check(connection);
  return {
    description: "Description " + MARKER,
    timeline: [
      { kind: "comment", id: "t-" + MARKER, author: user, body: "Comment " + MARKER, createdAt: 1760000060000 },
      { kind: "event", id: "e-" + MARKER, text: "Renamed to " + MARKER, createdAt: 1760000070000 },
    ],
    threads: [{
      id: "th-" + MARKER, path: CHANGED_PATH, side: "head", line: 3, resolved: false, outdated: false,
      comments: [{ id: "tc-" + MARKER, author: user, body: "Thread " + MARKER, createdAt: 1760000080000 }],
    }],
    viewedPaths: [CHANGED_PATH], mergeMethods: ["squash"],
  };
}
export async function browsePullRequests(connection) {
  check(connection);
  return { items: [summary(7)] };
}
export async function submitReview(connection, request) {
  check(connection);
  if (request.body && request.body.includes("refuse")) {
    throw new Error("Review rejected: " + request.body + " with " + connection.config.token);
  }
  return { reviewId: "review-" + MARKER };
}
export async function postComment(connection, request) {
  check(connection);
  if (request.body.includes("refuse")) {
    throw new Error("Cannot comment on " + request.repository + "#" + request.number);
  }
  return { commentId: "comment-" + MARKER };
}
export async function replyToThread(connection) {
  check(connection);
  return { commentId: "reply-" + MARKER };
}
export async function setThreadResolved(connection, request) {
  check(connection);
  return { resolved: request.resolved };
}
export async function setFileViewed(connection, request) {
  check(connection);
  return { viewed: request.viewed };
}
export async function updatePullRequest(connection, request) {
  check(connection);
  return { title: request.title ?? "Title " + MARKER, draft: false };
}
export async function mergePullRequest(connection) {
  check(connection);
  return { mergeCommitSha: "merge-" + MARKER };
}
export async function createTeam(config, request) {
  if (request.name.includes("taken")) {
    throw new Error("Team " + request.name + " exists, " + config.token);
  }
  return { values: { teamId: "team-" + MARKER } };
}
export async function syncTeamProjects(connection, request) {
  check(connection);
  const assigned = request.changes.flatMap((change) => [
    { localId: change.localId, remoteId: "r-" + change.localId },
    ...change.tasks.map((task) => ({ localId: task.localId, remoteId: "r-" + task.localId })),
  ]);
  return {
    cursor: "cursor-" + MARKER,
    projects: [{
      remoteId: "team-" + MARKER, name: "Team project " + MARKER, displayName: "Team project " + MARKER,
      code: "CODE-" + MARKER, color: "#123456", icon: { kind: "preset", name: "dot" }, status: "active",
      tasks: [{ remoteId: "tt-" + MARKER, name: "Team task " + MARKER, status: "active", billable: true, budgetMs: null }],
    }],
    assigned,
  };
}
`,
};

/**
 * Where the marker may stay: an error's message, and nothing else. ADR 0011
 * makes `error.message` a sensitive field: the scrubber removes the
 * connection's secrets, URLs and the home and user data folders, and cuts it
 * at 512 characters, but what a plugin echoes stays, such as `Issue KEY-1
 * not found`, and so does a file's name once its folder is replaced. Every
 * other field holds none, and no key does.
 */
const MARKER_ALLOWED_IN: ReadonlySet<string> = new Set(["error.message"]);

/** A place in a value that holds the marker: a field's `path`, in its key or its value. */
interface MarkedPlace {
  path: string;
  inKey: boolean;
  shown: string;
}

/** Every place in `value` that holds the marker, in a key or a value. */
function markedPlaces(value: unknown, at: string): MarkedPlace[] {
  if (typeof value === "string") {
    return MARKED.test(value)
      ? [{ path: at, inKey: false, shown: `${at} = ${JSON.stringify(value)}` }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      markedPlaces(item, `${at}[${index}]`),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = at ? `${at}.${key}` : key;
      return [
        ...(MARKED.test(key)
          ? [{ path: childPath, inKey: true, shown: `the key ${childPath}` }]
          : []),
        ...markedPlaces(child, childPath),
      ];
    });
  }
  return [];
}

/** Each leak, as the event that holds it and where, such as `api request x: plugin.id = "…"`. */
function leaksIn(events: readonly AjourEvent[]) {
  return events.flatMap((event) =>
    markedPlaces(event, "")
      .filter((place) => place.inKey || !MARKER_ALLOWED_IN.has(place.path))
      .map(
        (place) =>
          `${event.runtime} ${event.kind} ${event.name}: ${place.shown}`,
      ),
  );
}

/** Every key and string in `value`. */
function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...textsIn(child),
    ]);
  }
  return [];
}

/** A path with one separator and one case, to find it as the scrubber does. */
const comparable = (text: string) => text.replace(/[\\/]+/g, "/").toLowerCase();

/**
 * What no event holds anywhere, an error's message included: the secret, any
 * URL, and the home and user data folders. That is the scrubber's work.
 */
function survivorsIn(
  events: readonly AjourEvent[],
  folders: readonly string[],
) {
  return events.flatMap((event) =>
    textsIn(event).flatMap((text) => {
      const found = [
        /tok-canary-leak-7q4x-secret/i.test(text) && "the secret",
        /canary-leak-7q4x\.example\.test/i.test(text) && "the site",
        /[a-z][a-z0-9+.-]*:\/\//i.test(text) && "a URL",
        ...folders.map(
          (folder) => comparable(text).includes(comparable(folder)) && folder,
        ),
      ].filter((what): what is string => typeof what === "string");
      return found.map(
        (what) =>
          `${event.runtime} ${event.kind} ${event.name} holds ${what}: ${JSON.stringify(text)}`,
      );
    }),
  );
}

/** An agent's own fetch, which sends no browser origin. */
const agentFetch = globalThis.fetch;
let api: Awaited<ReturnType<typeof startLocalApi>>;
const renderer = createRecordingSink<AjourEvent>();
/** The Undo windows the flows offered, closed by the test when it chooses. */
let offerUndo: Mock;

vi.mock("@/features/feedback/undo-toast", () => ({
  offerUndo: vi.fn(),
  skipUndo: vi.fn(),
}));

/** The renderer's and the local API's events so far. */
const everything = () => [...renderer.events, ...api.events];

/** Fails on any marked event, listing where each leak is. */
function expectNoLeak(events: readonly AjourEvent[] = everything()) {
  expect(leaksIn(events)).toEqual([]);
  expect(survivorsIn(events, [os.homedir(), api.userDataPath])).toEqual([]);
}

/** Names of the events recorded since `from`, as `runtime kind name`. */
function namesSince(from: { renderer: number; api: number }) {
  return [
    ...renderer.events.slice(from.renderer),
    ...api.events.slice(from.api),
  ].map((event) => `${event.runtime} ${event.kind} ${event.name}`);
}

const mark = () => ({
  renderer: renderer.events.length,
  api: api.events.length,
});

/** Closes the last Undo window: its source writes and comments go. */
async function closeLastUndoWindow() {
  const options = offerUndo.mock.calls.at(-1)![1] as {
    onWindowClosed?: () => void;
  };
  // A source write waits out the Undo window, 8 seconds from its action.
  const realNow = Date.now;
  const now = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 9_000);
  try {
    options.onWindowClosed?.();
  } finally {
    now.mockRestore();
  }
}

function installWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
    },
  });
}

/** The renderer's modules, loaded once against the started API. */
let app: Awaited<ReturnType<typeof loadRenderer>>;

async function loadRenderer() {
  (await import("@/lib/wide-events")).replaceEventSink(renderer);
  offerUndo = (await import("@/features/feedback/undo-toast"))
    .offerUndo as Mock;
  const appApi = await import("@/lib/app-api");
  const { localStore } = await import("@/lib/local-store");
  const { syncTeamConnection } = await import("@/lib/team-sync");
  const { createPluginSettingsWorkflow } =
    await import("@/features/settings/plugin-settings-workflow");
  const workflow = createPluginSettingsWorkflow({
    ...appApi,
    syncTeamConnection,
    subscribeCatalog: () => () => undefined,
  });
  return {
    appApi,
    localStore,
    workflow,
    descriptions: await import("@/lib/description-save"),
    settle: await import("@/features/backlog/settle-dialog"),
    commentDeletes: await import("@/lib/comment-deletes"),
    teamSync: await import("@/lib/team-sync"),
    calendar: await import("@/lib/calendar-suggestions"),
    calendarDomain: await import("@/domain/time/calendar-suggestions"),
    bridge: await import("@/lib/mcp-bridge"),
    tools: await import("@/features/agents/agent-tool-runner"),
    agentComments: await import("@/lib/agent-comments"),
    agentCommentTools: await import("@/features/agents/agent-comment-tools"),
    errors: await import("@/features/feedback/app-error-handler"),
    backlogView: await import("@/lib/backlog-view-settings"),
  };
}

/** The connection the flows use, and one whose token the tracker revoked. */
const connections = { work: "", revoked: "" };

/** The repository and file of the plugin's pull request. */
const REPOSITORY = `acme-${MARKER}/api`;
const CHANGED_PATH = `src/${MARKER}/secret.ts`;

/** A code host operation, called as the local API's route takes it. */
const callCodeHost = (operation: string, body: unknown) =>
  fetchAsTheApp(
    `${api.baseUrl}/api/code-hosts/canary/connections/${connections.work}/${operation}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

beforeAll(async () => {
  api = await startLocalApi({ plugin: canaryPlugin });
  vi.resetModules();
  vi.stubEnv("VITE_APP_API_BASE_URL", api.baseUrl);
  vi.stubGlobal("fetch", fetchAsTheApp);
  vi.stubGlobal("EventSource", FetchEventSource);
  installWindow();
  app = await loadRenderer();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await api.stop();
});

describe("the privacy canary", () => {
  it("keeps a connection's names, URL and secret out of every event", async () => {
    const from = mark();
    const save = (token: string) =>
      new Promise<string>((resolve, reject) => {
        void app.workflow
          .execute({
            type: "save",
            pluginId: "canary",
            values: {
              label: `Work ${MARKER}`,
              tenantLabel: `Site ${MARKER}`,
              siteUrl: SITE,
              token,
              autoSync: false,
              autoSyncIntervalMinutes: 15,
              agentAccess: "readWrite",
            },
            onSaved: (connection) => resolve(connection.id),
          })
          .then((ok) => {
            if (!ok) reject(new Error("The connection wasn't saved."));
          });
      });
    connections.work = await save(SECRET);
    connections.revoked = await save(`${SECRET}-revoked`);
    // A save the API refuses: its validation error lists what it got.
    await expect(
      app.appApi.savePluginConnection("canary", {
        label: `Refused ${MARKER}`,
        siteUrl: `not a url ${MARKER}`,
        token: SECRET,
      }),
    ).rejects.toThrow();

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer command connection.save",
        "api request connection.save",
        "api plugin_operation connection.save",
      ]),
    );
    expectNoLeak();
  });

  it("keeps backlog items, their descriptions and comments out of every event", async () => {
    const from = mark();
    const disconnect = app.workflow.connect();
    try {
      expect(
        await app.workflow.execute({
          type: "sync",
          pluginId: "canary",
          connectionId: connections.work,
        }),
      ).toBe(true);
    } finally {
      disconnect();
    }
    const { items } = await app.appApi.listBacklogImportCandidates();
    await app.appApi.updateBacklogImportSelection(
      items.map((candidate) => candidate.id),
      true,
    );
    await app.appApi.commitSelectedBacklogImportsToLocalStore();
    const synced = app.localStore
      .snapshot()
      .workItems.find((item) => item.sourceId === `${MARKER}-1`)!;
    expect(synced.title).toContain(MARKER);

    // The user's own item and edits.
    const local = app.localStore.addWorkItem({
      title: `Local ${MARKER}`,
      description: `Local description ${MARKER}`,
    });
    app.localStore.saveWorkItemEdits(local, {
      title: `Renamed ${MARKER}`,
      description: `---\ntimelog:\n  project: ${MARKER}\n---\nNotes ${MARKER}`,
    });
    app.localStore.addSubtask(local, { title: `Subtask ${MARKER}` });

    // The synced description, written to the source.
    app.localStore.saveWorkItemEdits(synced._id, {
      description: `Description ${MARKER}\n\nMine ${MARKER}`,
    });
    expect(await app.descriptions.saveSyncedDescription(synced._id)).toEqual({
      kind: "written",
      merged: false,
    });

    // The comment thread, from the item's page.
    const thread = { sourceId: synced.sourceId! };
    const caller = { itemId: synced._id };
    await app.appApi.listItemComments(
      "canary",
      connections.work,
      { ...thread, limit: 5 },
      { ...caller, cacheHit: false },
    );
    await app.appApi.searchItemPeople(
      "canary",
      connections.work,
      { ...thread, query: MARKER, limit: 5 },
      caller,
    );
    const { comment } = await app.appApi.postItemComment(
      "canary",
      connections.work,
      { ...thread, body: `Body [@Ana ${MARKER}](mention:person-${MARKER})` },
      caller,
    );
    await app.appApi.editItemComment(
      "canary",
      connections.work,
      { ...thread, commentId: comment.id, body: `Edited ${MARKER}` },
      caller,
    );
    await app.appApi.setItemCommentReaction(
      "canary",
      connections.work,
      { ...thread, commentId: comment.id, reaction: "like", reacted: true },
      caller,
    );
    // The backlog's filters, with a value the user typed.
    app.backlogView.updateBacklogView({
      filters: [{ field: "sourceProject", value: `Project ${MARKER}` }],
    });
    app.localStore.setUserPreferences({ commitLinesNameSource: MARKER });

    app.commentDeletes.queueCommentDelete({
      itemId: synced._id,
      pluginId: "canary",
      connectionId: connections.work,
      ...thread,
      commentId: comment.id,
      at: Date.now(),
    });
    await app.commentDeletes.sendCommentDelete({
      pluginId: "canary",
      connectionId: connections.work,
      ...thread,
      commentId: comment.id,
    });

    // A settle that writes the source and posts its comment.
    await app.appApi.listBacklogSettleStates(
      "canary",
      connections.work,
      synced.sourceId!,
    );
    expect(
      await app.settle.settleBacklogItemWithUndo(
        synced,
        { state: { name: `Done ${MARKER}`, done: true } },
        `Settled, see ${SITE} ${MARKER}`,
        "ask",
      ),
    ).toBe(true);
    await closeLastUndoWindow();
    await waitForEvent(
      renderer.events,
      (event) => event.name === "settle_comment.send",
    );

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer job backlog.sync",
        "api plugin_operation backlog.sync",
        "renderer command backlog_import.commit",
        "renderer command backlog_item.create",
        "renderer command backlog_item.update",
        "renderer command backlog_item.save_description",
        "api plugin_operation description.read",
        "api plugin_operation description.write",
        "renderer command comment.list",
        "renderer command mention.search",
        "renderer command comment.post",
        "renderer command comment.edit",
        "renderer command comment.react",
        "renderer job comment.delete",
        "api plugin_operation comment.delete",
        "renderer command backlog_item.settle",
        "renderer job backlog.write_source",
        "api plugin_operation backlog.write_source",
        "renderer job settle_comment.send",
        "renderer command preferences.update",
      ]),
    );
    expectNoLeak();
  });

  it("keeps time entries' notes, projects and tasks out of every event", async () => {
    const from = mark();
    const projectId = app.localStore.addProject({
      name: `Project ${MARKER}`,
      color: "#123456",
      tasks: [{ name: `Task ${MARKER}` }],
    });
    const project = app.localStore
      .snapshot()
      .projects.find((candidate) => candidate._id === projectId)!;
    const taskId = project.tasks[0]!._id;
    app.localStore.updateProject(projectId, { name: `Renamed ${MARKER}` });
    app.localStore.renameProjectTask(projectId, taskId, `Renamed ${MARKER}`);
    app.localStore.addProjectTask(projectId, { name: `Other ${MARKER}` });

    app.localStore.startTimer({
      projectId,
      taskId,
      // A path is content too.
      note: `Plan in ${["C:", "Users", "Ana", MARKER, "plan.xlsx"].join("\\")}`,
    });
    const timer = app.localStore.snapshot().timers[0]!;
    app.localStore.editRunningEntry(timer._id, { note: `Edited ${MARKER}` });
    app.localStore.saveTimer(timer._id);
    app.localStore.saveManualTimeEntry({
      localDate: "2026-10-14",
      projectId,
      taskId,
      note: `Manual ${MARKER}`,
      durationMs: 1_800_000,
    });
    const entry = app.localStore
      .snapshot()
      .timesheetEntries.find((candidate) =>
        candidate.note?.startsWith("Manual"),
      )!;
    app.localStore.updateTimesheetEntry(entry._id, {
      projectId,
      taskId,
      note: `Updated ${MARKER}`,
      durationMs: 2_700_000,
    });
    app.localStore.duplicateTimesheetEntry(entry._id, {
      localDate: "2026-10-15",
      note: `Copy ${MARKER}`,
      durationMs: 900_000,
    });
    app.localStore.deleteTimesheetEntry(entry._id);

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer command project.create",
        "renderer command task.update",
        "renderer command time_entry.start",
        "renderer command time_entry.update",
        "renderer command time_entry.stop",
        "renderer command time_entry.create",
        "renderer command time_entry.duplicate",
        "renderer command time_entry.delete",
      ]),
    );
    expectNoLeak();
  });

  it("keeps calendar events' titles and IDs out of every event", async () => {
    const from = mark();
    const cache = new app.calendar.CalendarEventCache(
      app.appApi.listCalendarEvents,
    );
    const source = {
      pluginId: "canary",
      connectionId: connections.work,
      connectionLabel: `Work ${MARKER}`,
    };
    const range = { from: "2026-10-12", to: "2026-10-18" };
    await cache.load(source, range, { maxAgeMs: 0, force: true });
    const fetched = cache.get(source, range)!.events!;
    expect(fetched[0]!.title).toContain(MARKER);

    const state = app.localStore.snapshot();
    const project = state.projects.find((candidate) =>
      candidate.name.includes(MARKER),
    )!;
    const [suggestion] = app.calendarDomain.buildCalendarSuggestions(state, [
      { ...source, events: fetched },
    ]);
    expect(suggestion!.title).toContain(MARKER);
    app.localStore.acceptCalendarSuggestions([
      { suggestion: suggestion!, projectId: project._id, remember: true },
    ]);
    app.localStore.dismissCalendarSuggestions([suggestion!]);
    app.localStore.hideCalendarMeeting(suggestion!);
    const rule = app.localStore.snapshot().calendarEventRules?.[0];
    if (rule) app.localStore.forgetCalendarEventRule(rule._id);

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer job calendar.fetch",
        "api request calendar.fetch",
        "api plugin_operation calendar.fetch",
        "renderer command suggestion.add",
        "renderer command suggestion.dismiss",
        "renderer command event_rule.hide",
      ]),
    );
    expectNoLeak();
  });

  it("keeps an agent's names, prompts, tool inputs and answers out of every event", async () => {
    const from = mark();
    await app.appApi.updateMcpSettings(true);
    const { token } = await app.appApi.createMcpClient(`Agent ${MARKER}`);
    const statuses: string[] = [];
    const close = app.bridge.connectMcpBridge({
      runToolCall: app.tools.runAgentToolCall,
      onStatus: (status) => statuses.push(status),
    });
    let id = 0;
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await agentFetch(`${api.baseUrl}/mcp/ajour`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: (id += 1),
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const body = (await response.json()) as {
        result?: { structuredContent?: Record<string, unknown> };
      };
      return body.result?.structuredContent ?? {};
    };
    const state = app.localStore.snapshot();
    const synced = state.workItems.find(
      (item) => item.sourceId === `${MARKER}-1`,
    )!;
    const project = state.projects.find((candidate) =>
      candidate.name.includes(MARKER),
    )!;

    try {
      await vi.waitFor(() => expect(statuses).toContain("connected"));
      await call("list_work_items", { text: MARKER });
      await call("get_work_item", { workItemId: synced._id });
      await call("list_work_item_comments", { workItemId: synced._id });
      await call("create_work_item", {
        title: `Agent item ${MARKER}`,
        description: `Agent description ${MARKER}`,
      });
      await call("create_entry", {
        date: "2026-10-14",
        projectId: project._id,
        note: `Agent note ${MARKER}`,
        minutes: 30,
      });
      await call("post_work_item_comment", {
        workItemId: synced._id,
        body: `Agent comment ${MARKER}`,
      });
      // Its Undo window closes: the comment goes.
      for (const commentId of app.agentComments.agentCommentIds()) {
        await app.agentCommentTools.sendAgentComment(commentId);
      }
      await call("edit_work_item", {
        workItemId: synced._id,
        description: `Description ${MARKER}\n\nAgent ${MARKER}`,
      });
      // Calls that fail: a tool Ajour lacks, and arguments it refuses.
      await call(`tool_${MARKER}`, { prompt: MARKER });
      await call("create_entry", { date: MARKER, projectId: MARKER });

      const { sessionId } = (await call("begin_session", {
        title: `Session ${MARKER}`,
        estimateMinutes: 5,
      })) as { sessionId: string };
      await call("update_session", { sessionId, message: `Update ${MARKER}` });
      const { questionId } = (await call("ask", {
        question: `Question ${MARKER}?`,
        choices: [`Yes ${MARKER}`, `No ${MARKER}`],
        sessionId,
      })) as { questionId: string };
      await app.appApi.answerAgentQuestion(questionId, `Answer ${MARKER}`);
      await call("end_session", {
        sessionId,
        outcome: "done",
        summary: `Summary ${MARKER}`,
      });
    } finally {
      close();
    }
    await waitForEvent(api.events, (event) => event.name === "agent.session");

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer command agent_client.create",
        "api request agent_client.create",
        "api request agent_tool.call",
        "renderer job agent_tool.call",
        "renderer job agent_comment.send",
        "api plugin_operation comment.post",
        "renderer command question.answer",
        "api job agent.session",
      ]),
    );
    expectNoLeak();
  });

  it("keeps pull requests' repositories, files, reviews and comments out of every event", async () => {
    const from = mark();
    const synced = await app.appApi.syncCodeHostConnection(
      "canary",
      connections.work,
    );
    expect(synced.pullRequests[0]!.title).toContain(MARKER);
    const [pullRequest] = app.localStore.snapshot().pullRequests ?? [];
    expect(pullRequest!.facts.repository).toContain(MARKER);
    app.localStore.changePullRequest(pullRequest!._id, {
      type: "snooze",
      until: Date.now() + 3_600_000,
    });
    app.localStore.changePullRequest(pullRequest!._id, { type: "unsnooze" });
    app.localStore.changePullRequest(pullRequest!._id, { type: "settle" });

    // The operations no screen of the renderer calls yet, as the routes take them.
    const pull = { repository: REPOSITORY, number: 7 };
    const anchor = { path: CHANGED_PATH, side: "head", line: 3 };
    for (const [operation, body] of [
      ["getPullRequestContent", pull],
      [
        "getFileContent",
        { repository: REPOSITORY, sha: "sha7", path: CHANGED_PATH },
      ],
      ["getPullRequestConversation", pull],
      [
        "browsePullRequests",
        { repository: REPOSITORY, state: "open", text: MARKER },
      ],
      [
        "submitReview",
        {
          ...pull,
          headSha: "sha7",
          verdict: "comment",
          body: `Review ${MARKER}`,
          comments: [{ ...anchor, body: `Line comment ${MARKER}` }],
        },
      ],
      [
        "postComment",
        {
          ...pull,
          body: `Comment ${MARKER}`,
          anchor: { ...anchor, headSha: "sha7" },
        },
      ],
      [
        "replyToThread",
        { ...pull, threadId: `th-${MARKER}`, body: `Reply ${MARKER}` },
      ],
      [
        "setThreadResolved",
        { ...pull, threadId: `th-${MARKER}`, resolved: true },
      ],
      ["setFileViewed", { ...pull, path: CHANGED_PATH, viewed: true }],
      ["updatePullRequest", { ...pull, title: `Renamed ${MARKER}` }],
      [
        "mergePullRequest",
        {
          ...pull,
          method: "squash",
          headSha: "sha7",
          commitTitle: `Merge ${MARKER}`,
          commitMessage: `Merge body ${MARKER}`,
        },
      ],
    ] as const) {
      expect((await callCodeHost(operation, body)).status, operation).toBe(200);
    }

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer job pull_request.sync",
        "api request pull_request.sync",
        "api plugin_operation pull_request.sync",
        "renderer command pull_request.snooze",
        "renderer command pull_request.settle",
        ...[
          "load",
          "load_file",
          "load_conversation",
          "browse",
          "submit_review",
          "comment",
          "reply",
          "resolve_thread",
          "mark_file_viewed",
          "update",
          "merge",
        ].flatMap((name) => [
          `api request pull_request.${name}`,
          `api plugin_operation pull_request.${name}`,
        ]),
      ]),
    );
    expectNoLeak();
  });

  it("keeps a team's projects, tasks and name out of every event", async () => {
    const from = mark();
    const created = await app.appApi.createTeam("canary", {
      values: {
        label: `Work ${MARKER}`,
        tenantLabel: `Site ${MARKER}`,
        siteUrl: SITE,
        token: SECRET,
      },
      team: { name: `Team ${MARKER}` },
    });
    expect(created.values.teamId).toContain(MARKER);

    // The first sync brings the team's project here. Then a local project
    // goes to the team, and the next sync sends it.
    const sync = () =>
      app.teamSync.syncTeamConnection("canary", connections.work);
    const first = await sync();
    expect(first.createdProjectIds).toHaveLength(1);
    const mine = app.localStore
      .snapshot()
      .projects.find(
        (project) => project.name.includes(MARKER) && !project.team,
      )!;
    const shared = app.localStore.shareProjectWithTeam(
      connections.work,
      mine._id,
    );
    expect(shared.result.kind).toBe("shared");
    // The Undo toast closes, so the sync no longer waits for the project.
    app.localStore.forgetUndo(shared.undoToken!);
    const outcome = await sync();
    expect(outcome.sentProjectCount).toBe(1);
    expect(
      app.localStore
        .snapshot()
        .projects.some((project) => project.name === `Team project ${MARKER}`),
    ).toBe(true);

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer command team.create",
        "api request team.create",
        "api plugin_operation team.create",
        "renderer command project.share",
        "renderer job team.sync",
        "api request team.sync",
        "api plugin_operation team.sync",
      ]),
    );
    expectNoLeak();
  });

  it("keeps a plugin error that echoes the secret, and what breaks the contract, out of every event", async () => {
    const from = mark();
    await expect(
      app.appApi.syncBacklogConnection("canary", connections.revoked),
    ).rejects.toThrow();
    await new app.calendar.CalendarEventCache(
      app.appApi.listCalendarEvents,
    ).load(
      { pluginId: "canary", connectionId: connections.revoked },
      { from: "2026-10-12", to: "2026-10-18" },
      { maxAgeMs: 0, force: true },
    );
    const synced = app.localStore
      .snapshot()
      .workItems.find((item) => item.sourceId === `${MARKER}-1`)!;
    await expect(
      app.appApi.postItemComment(
        "canary",
        connections.work,
        { sourceId: synced.sourceId!, body: `Please refuse me ${MARKER}` },
        { itemId: synced._id },
      ),
    ).rejects.toThrow();
    const garbled = await app.appApi.savePluginConnection("canary", {
      label: `Garbled ${MARKER}`,
      tenantLabel: `Site ${MARKER}`,
      siteUrl: SITE,
      token: `${SECRET}-garbled`,
      autoSync: false,
      autoSyncIntervalMinutes: 15,
    });
    await expect(
      app.appApi.syncBacklogConnection("canary", garbled.connection.id),
    ).rejects.toThrow();
    // Requests Ajour can't read or route, which name content in their path.
    await fetchAsTheApp(`${api.baseUrl}/api/${MARKER}?q=${MARKER}#${MARKER}`);
    await fetchAsTheApp(
      `${api.baseUrl}/api/backlog-comments/canary/connections/${connections.work}/${MARKER}`,
      { method: "POST", body: "{}" },
    );
    await fetchAsTheApp(
      `${api.baseUrl}/api/plugins/canary/connections/${connections.work}/sync`,
      { method: "POST", body: `{"trigger": "${MARKER}` },
    );
    // An error nothing caught, whose message names content.
    const listeners = new Map<string, (event: unknown) => void>();
    app.errors.installAppErrorHandler({
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        void listeners.set(type, listener),
    } as unknown as Pick<EventTarget, "addEventListener">);
    listeners.get("error")!({
      error: new Error(`Could not render ${MARKER} from ${SITE}`),
      preventDefault: () => {},
    });

    // Errors that echo what the plugin worked on: an issue's key, a pull
    // request's repository and file, a review's body, a team's name, and a
    // file under the home and user data folders.
    await expect(
      app.appApi.postItemComment(
        "canary",
        connections.work,
        { sourceId: synced.sourceId!, body: "There is no such issue" },
        { itemId: synced._id },
      ),
    ).rejects.toThrow();
    const pull = { repository: REPOSITORY, number: 7 };
    const homeFile = path.join(os.homedir(), MARKER, "plan.xlsx");
    const dataFile = path.join(api.userDataPath, MARKER, "plan.xlsx");
    const failing = [
      [
        "getFileContent",
        { repository: REPOSITORY, sha: "missing", path: CHANGED_PATH },
      ],
      [
        "getFileContent",
        { repository: REPOSITORY, sha: "local", path: homeFile },
      ],
      [
        "getFileContent",
        { repository: REPOSITORY, sha: "local", path: dataFile },
      ],
      [
        "submitReview",
        {
          ...pull,
          headSha: "sha7",
          verdict: "comment",
          body: `Please refuse ${MARKER}`,
          comments: [],
        },
      ],
      ["postComment", { ...pull, body: `Please refuse ${MARKER}` }],
    ] as const;
    for (const [operation, body] of failing) {
      expect((await callCodeHost(operation, body)).status, operation).toBe(502);
    }
    await expect(
      app.appApi.createTeam("canary", {
        values: {
          label: "Work",
          tenantLabel: "Site",
          siteUrl: SITE,
          token: SECRET,
        },
        team: { name: `Team ${MARKER} taken` },
      }),
    ).rejects.toThrow();
    await expect(
      app.teamSync.syncTeamConnection("canary", connections.revoked),
    ).rejects.toThrow();
    await expect(
      app.appApi.syncCodeHostConnection("canary", connections.revoked),
    ).rejects.toThrow();

    const pluginFailure = api.events.find(
      (event) =>
        event.kind === "plugin_operation" &&
        event.name === "backlog.sync" &&
        event.outcome_reason === "plugin_error",
    );
    // The scrubbed message stays: it says what failed, without the secret
    // or the URL.
    expect(pluginFailure?.error?.message).toBe(
      "The tracker refused [secret] at [url]",
    );
    // What a plugin echoes stays too, and is the only place the marker may be.
    const messages = (name: string) =>
      api.events
        .filter(
          (event) =>
            event.kind === "plugin_operation" &&
            event.name === name &&
            event.outcome === "error",
        )
        .map((event) => event.error?.message);
    expect(messages("comment.post")).toContain(`Issue ${MARKER}-9 not found`);
    expect(messages("pull_request.load_file")).toEqual([
      `Cannot read ${CHANGED_PATH} in ${REPOSITORY}`,
      `ENOENT: no such file or directory, open '${path.join("~", MARKER, "plan.xlsx")}'`,
      `ENOENT: no such file or directory, open '${path.join("[user data]", MARKER, "plan.xlsx")}'`,
    ]);
    expect(messages("pull_request.submit_review")).toEqual([
      `Review rejected: Please refuse ${MARKER} with [secret]`,
    ]);
    expect(messages("pull_request.comment")).toEqual([
      `Cannot comment on ${REPOSITORY}#7`,
    ]);
    expect(messages("team.create")).toEqual([
      `Team Team ${MARKER} taken exists, [secret]`,
    ]);
    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "api plugin_operation team.sync",
        "api plugin_operation pull_request.sync",
        "api plugin_operation pull_request.load_file",
        "api plugin_operation pull_request.submit_review",
        "api plugin_operation pull_request.comment",
        "api plugin_operation team.create",
        "renderer job backlog.sync",
        "api request backlog.sync",
        "api plugin_operation backlog.sync",
        "renderer job calendar.fetch",
        "api plugin_operation calendar.fetch",
        "api plugin_operation comment.post",
        "api request api.request",
        "renderer crash app.error",
      ]),
    );
    expectNoLeak();
  });

  it("removes the connection without its names or secret in any event", async () => {
    const from = mark();
    const disconnect = app.workflow.connect();
    try {
      expect(
        await app.workflow.execute({
          type: "delete",
          pluginId: "canary",
          connectionId: connections.revoked,
        }),
      ).toBe(true);
    } finally {
      disconnect();
    }

    expect(namesSince(from)).toEqual(
      expect.arrayContaining([
        "renderer command connection.delete",
        "api request connection.delete",
      ]),
    );
    // Every event of every flow, once more, with the marker everywhere.
    expect(everything().length).toBeGreaterThan(100);
    expectNoLeak();
  });
});

describe("what the canary lets through", () => {
  const event = (fields: Record<string, unknown>) =>
    ({
      runtime: "api",
      kind: "request",
      name: "x",
      ...fields,
    }) as unknown as AjourEvent;
  const home = path.join(os.homedir(), "ana");

  it("lets the marker stay in an error's message and nowhere else", () => {
    expect(
      leaksIn([
        event({ error: { type: "Error", message: `Issue ${MARKER}-9 gone` } }),
      ]),
    ).toEqual([]);
    for (const fields of [
      { error: { type: MARKER, message: "gone" } },
      { error: { type: "Error", message: "gone", code: MARKER } },
      { error: { type: "Error", message: "gone", [MARKER]: "x" } },
      { plugin: { id: MARKER } },
      { [MARKER]: 1 },
      { connection: { id: `c-${MARKER}` } },
    ]) {
      expect(leaksIn([event(fields)]), JSON.stringify(fields)).not.toEqual([]);
    }
  });

  it("refuses the secret, a URL and the user's folders even in an error's message", () => {
    const folders = [home, api.userDataPath];
    for (const message of [
      `refused ${SECRET}`,
      `refused ${SECRET}-revoked`,
      `at ${SITE}`,
      `at ${SITE}/rest/api`,
      "see https://example.test/a",
      `no such file ${path.join(home, "plan.xlsx")}`,
      `no such file ${path.join(api.userDataPath, "state.json")}`,
      // As JSON escapes a Windows path.
      `no such file ${JSON.stringify(path.join(home, "plan.xlsx")).slice(1, -1)}`,
    ]) {
      expect(
        survivorsIn([event({ error: { message } })], folders),
        message,
      ).not.toEqual([]);
    }
    expect(
      survivorsIn(
        [
          event({
            error: {
              message: `refused [secret] at [url], ~/plan.xlsx, [user data]/x, ${MARKER}`,
            },
          }),
        ],
        folders,
      ),
    ).toEqual([]);
  });
});
