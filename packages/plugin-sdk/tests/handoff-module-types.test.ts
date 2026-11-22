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

it("types handoff exports with and without a connection", () => {
  expect(Object.keys(withoutConnection)).toHaveLength(5);
  expect(Object.keys(withConnection)).toHaveLength(5);
  expect(typeof both.startHandoff).toBe("function");
});
