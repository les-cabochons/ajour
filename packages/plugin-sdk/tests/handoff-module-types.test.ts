import { expect, it } from "vitest";
import type {
  CloseThreadRequest,
  ListThreadsRequest,
  PluginConnection,
  PluginModule,
  ReadHandoffStatesRequest,
  StartHandoffRequest,
} from "../index.ts";

/*
 * These compile only while `PluginModule` accepts each way a handoff plugin
 * is written: tools without a connection (unchanged), tools with one, and a
 * plugin with both kinds.
 */
const withoutConnection = {
  detectTools: () => ({ tools: [{ id: "t3", available: true }] }),
  startHandoff: (request: StartHandoffRequest) => ({
    threadId: request.title,
    native: {},
  }),
  readHandoffStates: (request: ReadHandoffStatesRequest) =>
    request.handoffs.map((h) => ({
      id: h.id,
      state: "working" as const,
      native: {},
    })),
  listThreads: (request: ListThreadsRequest) => ({
    threads: [
      {
        threadId: `${request.folder.id}:1`,
        title: "[PAY-12] Fix login redirect",
        native: {},
        updatedAt: request.since,
      },
    ],
  }),
  closeThread: (_request: CloseThreadRequest) => ({}),
} satisfies PluginModule;

const withConnection = {
  detectTools: (connection?: PluginConnection) => ({
    tools: [{ id: "opencode", available: Boolean(connection) }],
  }),
  startHandoff: async (
    connection: PluginConnection,
    request: StartHandoffRequest,
  ) => ({ threadId: `${connection.id}:${request.title}`, native: {} }),
  readHandoffStates: (
    _connection: PluginConnection,
    request: ReadHandoffStatesRequest,
  ) =>
    request.handoffs.map((h) => ({
      id: h.id,
      state: "ready" as const,
      native: {},
    })),
  listThreads: (
    _connection: PluginConnection,
    request: ListThreadsRequest,
  ) => ({
    threads: Array.from({ length: Math.min(request.limit, 1) }, () => ({
      threadId: "session",
      title: "[PAY-12] Fix login redirect",
      native: {},
    })),
  }),
  closeThread: async (
    _connection: PluginConnection,
    _request: CloseThreadRequest,
  ) => ({}),
} satisfies PluginModule;

const both: PluginModule = {
  startHandoff(...args) {
    const request = args.length === 2 ? args[1] : args[0];
    return { threadId: request.tool, native: {} };
  },
};

/*
 * A tool that makes its own worktree reads the branch to create and the
 * source it starts from. Both are optional strings: under Main folder the
 * start has neither.
 */
const ownWorktree = {
  startHandoff: (request: StartHandoffRequest) => {
    const branch: string | undefined = request.branch;
    const source: string | undefined = request.source;
    return {
      threadId: request.title,
      native: branch ? { branch, base: source ?? "HEAD" } : {},
    };
  },
} satisfies PluginModule;

it("types the branch and the source of a start as optional text", () => {
  const request = {
    tool: "own",
    folder: { id: "folder-1", name: "atlas-web" },
    prompt: "Do it",
    title: "[4821] Week grid",
    item: { key: "4821", url: "" },
    settings: {},
  } satisfies StartHandoffRequest;
  expect(ownWorktree.startHandoff(request).native).toEqual({});
  expect(
    ownWorktree.startHandoff({
      ...request,
      branch: "4821-week-grid",
      source: "origin/main",
    }).native,
  ).toEqual({ branch: "4821-week-grid", base: "origin/main" });
});

it("types handoff exports with and without a connection", () => {
  expect(Object.keys(withoutConnection)).toHaveLength(5);
  expect(Object.keys(withConnection)).toHaveLength(5);
  expect(typeof both.startHandoff).toBe("function");
});

it("types the repository folder of a start in a worktree as an optional folder", () => {
  const request = {
    tool: "tool",
    folder: { id: "worktree-1", name: "aj-4821" },
    repositoryFolder: { id: "folder-1", name: "atlas-web" },
    prompt: "Do it",
    title: "[4821] Week grid",
    item: { key: "4821", url: "" },
    settings: {},
  } satisfies StartHandoffRequest;
  // A step that must outlast a refused start goes to the repository folder.
  const lasting: { id: string; name: string } =
    request.repositoryFolder ?? request.folder;
  expect(lasting.id).toBe("folder-1");
});
