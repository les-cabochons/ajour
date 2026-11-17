import { expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../plugin-api-4.ts";
import {
  summarizePluginAccess,
  pluginAccessDifference,
  widensAccess,
} from "../plugin-access.ts";
import { jiraManifest } from "./fixtures/api-4-manifests.ts";

it("accepts a handoff-only API 4 plugin, requires code and includes it in access consent", () => {
  const base = jiraManifest();
  const manifest = {
    ...base,
    capabilities: {
      handoff: {
        tools: [
          { id: "t3", label: "T3 Code", iconSvg: "<svg/>", settings: [] },
        ],
      },
    },
  };
  const parsed = pluginApi4ManifestSchema.parse(manifest);
  const before = summarizePluginAccess(pluginApi4ManifestSchema.parse(base), {
    agentPrompts: {},
  });
  const after = summarizePluginAccess(parsed, { agentPrompts: {} });
  expect(after.capabilities).toEqual(["handoff"]);
  expect(widensAccess(pluginAccessDifference(before, after))).toBe(true);
  expect(
    pluginApi4ManifestSchema.safeParse({ ...manifest, entrypoint: undefined })
      .success,
  ).toBe(false);
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      capabilities: { handoff: { tools: [] } },
    }).success,
  ).toBe(false);
  const tool = manifest.capabilities.handoff.tools[0]!;
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      capabilities: { handoff: { tools: [tool, tool] } },
    }).success,
  ).toBe(false);
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      capabilities: {
        handoff: {
          tools: [
            {
              ...tool,
              settings: [
                { id: "token", label: "Token", type: "password", secret: true },
              ],
            },
          ],
        },
      },
    }).success,
  ).toBe(false);
});

import { handoffNativeSchema } from "../handoffs.ts";
it("bounds native state by serialized UTF-8 bytes with an explicit refusal", () => {
  expect(handoffNativeSchema.safeParse({ x: "a".repeat(4088) }).success).toBe(
    true,
  );
  const oversized = handoffNativeSchema.safeParse({ x: "a".repeat(4089) });
  expect(oversized.success).toBe(false);
  if (!oversized.success) expect(oversized.error.message).toContain("4 KB");
  expect(handoffNativeSchema.safeParse({ x: "�".repeat(2045) }).success).toBe(
    false,
  );
});

it("validates plugin prompt default slots and filters at manifest parse", () => {
  for (const promptTemplate of [
    "{{item.nope}}",
    "{{item.key|bogus}}",
    "{{weekOf}}",
  ])
    expect(
      pluginApi4ManifestSchema.safeParse({
        ...jiraManifest(),
        capabilities: {
          handoff: {
            promptTemplate,
            tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
          },
        },
      }).success,
    ).toBe(false);
});

import {
  handoffRecordSchema,
  handoffUpdateSchema,
  isHttpsUrl,
} from "../handoffs.ts";
it("stores pull request links only when they are https", () => {
  const record = {
    id: "h1",
    pluginId: "p",
    toolId: "t3",
    workItemId: "w1",
    projectId: "p1",
    folderId: "f1",
    threadId: "thread",
    native: {},
    title: "Fix it",
    startedAt: 1,
    state: "working",
    checkedAt: 1,
    changedAt: 1,
    history: [],
  };
  const withLink = (url: string) => ({
    ...record,
    pullRequests: [{ url, title: "PR" }],
  });
  expect(
    handoffRecordSchema.safeParse(withLink("https://example.test/pr/1"))
      .success,
  ).toBe(true);
  for (const url of [
    "http://example.test/pr/1",
    "javascript:alert(1)",
    "file:///C:/secrets.txt",
    "not a url",
  ]) {
    expect(isHttpsUrl(url)).toBe(false);
    expect(handoffRecordSchema.safeParse(withLink(url)).success).toBe(false);
    // A tool's answer still parses: the API drops the link before storing.
    expect(
      handoffUpdateSchema.safeParse({
        id: "h1",
        state: "ready",
        native: {},
        pullRequests: [{ url }],
      }).success,
    ).toBe(true);
  }
});

import {
  listThreadsRequestSchema,
  listThreadsResultSchema,
} from "../handoffs.ts";
it("lets a tool declare that it lists threads, off by default", () => {
  const manifest = (tool: Record<string, unknown>) => ({
    ...jiraManifest(),
    capabilities: {
      handoff: {
        tools: [
          { id: "t3", label: "T3", iconSvg: "<svg/>", settings: [], ...tool },
        ],
      },
    },
  });
  const plain = pluginApi4ManifestSchema.parse(manifest({}));
  expect(plain.capabilities.handoff?.tools[0]?.listsThreads).toBeUndefined();
  const listing = pluginApi4ManifestSchema.parse(
    manifest({ listsThreads: true }),
  );
  expect(listing.capabilities.handoff?.tools[0]?.listsThreads).toBe(true);
  expect(
    pluginApi4ManifestSchema.safeParse(manifest({ listsThreads: "yes" }))
      .success,
  ).toBe(false);
});

it("bounds a thread listing's request and answer as a state read's", () => {
  const request = { tool: "t3", folder: { id: "f1" }, limit: 50 };
  expect(listThreadsRequestSchema.safeParse(request).success).toBe(true);
  expect(
    listThreadsRequestSchema.safeParse({ ...request, since: 1000 }).success,
  ).toBe(true);
  for (const bad of [
    { ...request, limit: 0 },
    { ...request, limit: 201 },
    { ...request, folder: { id: "f1", path: "C:\repo" } },
    { ...request, extra: true },
  ])
    expect(listThreadsRequestSchema.safeParse(bad).success).toBe(false);

  const thread = {
    threadId: "thread-1",
    title: "[PAY-12] Fix login redirect",
    link: "https://example.test/thread-1",
    resume: { command: "resume", args: { thread: "thread-1" } },
    native: { status: "idle" },
    updatedAt: 1000,
  };
  expect(listThreadsResultSchema.safeParse({ threads: [thread] }).success).toBe(
    true,
  );
  for (const bad of [
    { threads: Array.from({ length: 201 }, () => thread) },
    { threads: [{ ...thread, title: "" }] },
    { threads: [{ ...thread, title: "x".repeat(501) }] },
    { threads: [{ ...thread, threadId: "" }] },
    { threads: [{ ...thread, link: "x".repeat(2001) }] },
    { threads: [{ ...thread, native: { x: "a".repeat(4089) } }] },
    { threads: [{ ...thread, updatedAt: Number.NaN }] },
    { threads: [{ ...thread, extra: true }] },
    [thread],
  ])
    expect(listThreadsResultSchema.safeParse(bad).success).toBe(false);
});

import {
  handoffStateSchema,
  handoffToolFeatures,
  readHandoffStatesResultSchema,
} from "../handoffs.ts";
import { declaresHookUrl } from "../plugin-api-4.ts";
it("lets a tool say it doesn't follow its threads' state, following by default", () => {
  const manifest = (tool: Record<string, unknown>) => ({
    ...jiraManifest(),
    capabilities: {
      handoff: {
        tools: [
          { id: "t3", label: "T3", iconSvg: "<svg/>", settings: [], ...tool },
        ],
      },
    },
  });
  const plain = pluginApi4ManifestSchema.parse(manifest({}));
  expect(plain.capabilities.handoff?.tools[0]?.followsState).toBe(true);
  const blind = pluginApi4ManifestSchema.parse(
    manifest({ followsState: false }),
  );
  expect(blind.capabilities.handoff?.tools[0]?.followsState).toBe(false);
  expect(
    pluginApi4ManifestSchema.safeParse(manifest({ followsState: "no" }))
      .success,
  ).toBe(false);
});

it("keeps started a state only Ajour gives, never one a tool reports", () => {
  expect(handoffStateSchema.safeParse("started").success).toBe(true);
  expect(
    readHandoffStatesResultSchema.safeParse([
      { id: "h1", state: "started", native: {} },
    ]).success,
  ).toBe(false);
  expect(
    readHandoffStatesResultSchema.safeParse([
      { id: "h1", state: "working", native: {} },
    ]).success,
  ).toBe(true);
});

it("derives each tool's features from what it declares", () => {
  expect(handoffToolFeatures({ followsState: true })).toEqual([
    "starts-threads",
    "follows-state",
  ]);
  expect(
    handoffToolFeatures({
      followsState: true,
      listsThreads: true,
      hooks: true,
    }),
  ).toEqual([
    "starts-threads",
    "follows-state",
    "finds-threads",
    "updates-within-seconds",
  ]);
  // Only a tool that says it posts hooks updates within seconds.
  expect(
    handoffToolFeatures({ followsState: true, listsThreads: true }),
  ).toEqual(["starts-threads", "follows-state", "finds-threads"]);
  expect(
    handoffToolFeatures({ followsState: false, listsThreads: true }),
  ).toEqual(["starts-threads", "finds-threads"]);
  expect(handoffToolFeatures({})).toEqual(["starts-threads", "follows-state"]);
});

it("lets a tool say it posts hooks only with a hook-url command and while it follows state", () => {
  const hookCommand = {
    id: "start",
    executable: "claude",
    args: ["--hook", "{hook:hook-url}"],
    mode: "detached" as const,
  };
  const plainCommand = { ...hookCommand, args: ["-p", "{prompt:text}"] };
  const manifest = (
    tools: Record<string, unknown>[],
    commands: unknown[] = [hookCommand],
  ) => ({
    ...jiraManifest(),
    capabilities: {
      handoff: {
        tools: tools.map((tool, index) => ({
          id: `tool-${index}`,
          label: "Tool",
          iconSvg: "<svg/>",
          settings: [],
          ...tool,
        })),
      },
    },
    processes: {
      executables: { claude: { names: ["claude"] } },
      commands,
    },
  });
  const parsed = pluginApi4ManifestSchema.parse(
    manifest([{ hooks: true }, {}]),
  );
  expect(parsed.capabilities.handoff?.tools.map((t) => t.hooks)).toEqual([
    true,
    false,
  ]);
  const plainHooks = pluginApi4ManifestSchema.safeParse(
    manifest([{ hooks: true }], [plainCommand]),
  );
  expect(plainHooks.success).toBe(false);
  expect(plainHooks.error?.issues[0]).toMatchObject({
    path: ["capabilities", "handoff", "tools", 0, "hooks"],
    message:
      'The handoff tool "tool-0" posts hooks, so the plugin needs a command with a hook-url slot.',
  });
  const noProcesses = pluginApi4ManifestSchema.safeParse({
    ...manifest([{ hooks: true }]),
    processes: undefined,
  });
  expect(noProcesses.success).toBe(false);
  const blind = pluginApi4ManifestSchema.safeParse(
    manifest([{ hooks: true, followsState: false }]),
  );
  expect(blind.success).toBe(false);
  expect(blind.error?.issues[0]).toMatchObject({
    path: ["capabilities", "handoff", "tools", 0, "hooks"],
    message:
      'The handoff tool "tool-0" doesn\'t follow state, so its hooks would never be read.',
  });
  expect(
    pluginApi4ManifestSchema.safeParse(manifest([{ hooks: "yes" }])).success,
  ).toBe(false);
});

it("tells whether a plugin declares a command that receives a hook URL", () => {
  const command = (args: unknown[]) => ({
    id: "start",
    executable: "claude",
    args,
    mode: "detached" as const,
  });
  const processes = (args: unknown[]) =>
    pluginApi4ManifestSchema.parse({
      ...jiraManifest(),
      capabilities: {
        handoff: {
          tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
        },
      },
      processes: {
        executables: { claude: { names: ["claude"] } },
        commands: [command(args)],
      },
    });
  expect(declaresHookUrl(processes(["-p", "{prompt:text}"]))).toBe(false);
  expect(declaresHookUrl(processes(["--hook", "{hook:hook-url}"]))).toBe(true);
  expect(
    declaresHookUrl(
      processes([
        "--settings",
        { kind: "hook-url", name: "hook", template: '{"url":"{url}"}' },
      ]),
    ),
  ).toBe(true);
  expect(declaresHookUrl(pluginApi4ManifestSchema.parse(jiraManifest()))).toBe(
    false,
  );
});
