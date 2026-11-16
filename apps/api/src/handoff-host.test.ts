import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PluginManager } from "./plugin-host.ts";
import type { BrokerCaller } from "./broker-port.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";

it("binds every handoff operation's process calls to the host's project and validates results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-host-"));
  const directory = path.join(root, "plugin");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "handoff",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      capabilities: {
        handoff: {
          tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
        },
      },
    }),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    `
async function process() { await ajour.process.run({ command: 'probe', args: {} }); }
export async function detectTools() { await process(); return { tools: [{ id: 't3', available: true }] }; }
export async function startHandoff(request) { await process(); return { threadId: 'thread', native: {} }; }
export async function readHandoffStates(request) { await process(); return request.handoffs.some(h => h.threadId === 'bad') ? [{ id: 'foreign', state: 'ready', native: {} }] : request.handoffs.map(h => ({ id: h.id, state: 'ready', native: {} })); }
`,
  );
  const callers: BrokerCaller[] = [];
  const closed: string[] = [];
  const manager = new PluginManager({
    runtime: new InProcessPluginRuntime(),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [directory],
    processBroker: {
      forOperation(caller) {
        callers.push(caller);
        return {
          async run() {
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          close() {
            closed.push(caller.method);
          },
        };
      },
    },
  });
  try {
    await manager.detectTools("handoff", "p");
    await manager.startHandoff(
      "handoff",
      {
        tool: "t3",
        folder: { id: "f", name: "Repo" },
        title: "Title",
        prompt: "Prompt",
        item: { key: "KEY", url: "" },
        settings: {},
      },
      "p",
    );
    const request = {
      tool: "t3",
      handoffs: [{ id: "h", threadId: "thread", folderId: "f", native: {} }],
    };
    expect(
      await manager.readHandoffStates("handoff", request, "p"),
    ).toMatchObject([{ id: "h", state: "ready" }]);
    await expect(
      manager.readHandoffStates(
        "handoff",
        {
          ...request,
          handoffs: [
            { ...request.handoffs[0]!, id: "different" },
            request.handoffs[0]!,
          ],
        },
        "p",
      ),
    ).resolves.toHaveLength(2);
    expect(callers.map((c) => [c.method, c.projectId])).toEqual([
      ["detectTools", "p"],
      ["startHandoff", "p"],
      ["readHandoffStates", "p"],
      ["readHandoffStates", "p"],
    ]);
    expect(new Set(closed)).toEqual(
      new Set(["detectTools", "startHandoff", "readHandoffStates"]),
    );
    await expect(
      manager.readHandoffStates(
        "handoff",
        {
          ...request,
          handoffs: [{ ...request.handoffs[0]!, threadId: "bad" }],
        },
        "p",
      ),
    ).rejects.toThrow("exactly once");
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "javascript:alert(1)",
  "file:///secret",
  "data:text/plain,x",
  "vbscript:x",
  "blob:https://x",
  "about:blank",
  "undeclared:thread",
  "http://example.test/thread",
  "not a URL",
  "",
])(
  "refuses unsafe start links and strips unsafe refresh links: %s",
  async (link) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "handoff-links-"));
    await writeFile(
      path.join(root, "plugin.json"),
      JSON.stringify({
        id: "links",
        version: "1.0.0",
        apiVersion: 4,
        displayName: "Links",
        description: "Test",
        iconSvg: "<svg/>",
        entrypoint: "plugin.mjs",
        connectionFields: [],
        processes: {
          openSchemes: ["t3"],
          executables: { tool: { names: ["tool"] } },
          commands: [
            { id: "resume", executable: "tool", args: [], mode: "capture" },
          ],
        },
        capabilities: {
          handoff: {
            tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
          },
        },
      }),
    );
    await writeFile(
      path.join(root, "plugin.mjs"),
      `export function startHandoff(r) { return { threadId: 't', native: r.title === 'large' ? { payload: 'x'.repeat(4096) } : {}, ...(r.title === 'declared' ? { resume: { command: 'resume', args: {} } } : r.title === 'resume' ? { resume: { command: 'missing', args: {} } } : { link: r.title === "empty-link" ? "" : r.title }) }; }
export function readHandoffStates(r) { return r.handoffs.map(h => ({ id: h.id, state: 'ready', native: h.threadId === 'large' ? { payload: 'x'.repeat(4096) } : {}, link: ${JSON.stringify(link)}, pullRequests: [{ url: ${JSON.stringify(link)} }, { url: 'https://example.test/pr' }] })); }`,
    );
    const manager = new PluginManager({
      runtime: new InProcessPluginRuntime(),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: true,
      developmentPluginDirectories: [root],
    });
    try {
      const request = {
        tool: "t3",
        folder: { id: "f", name: "Repo" },
        title: link || "empty-link",
        prompt: "P",
        item: { key: "", url: "" },
        settings: {},
      };
      await expect(manager.startHandoff("links", request, "p")).rejects.toThrow(
        /link/i,
      );
      await expect(
        manager.startHandoff("links", { ...request, title: "resume" }, "p"),
      ).rejects.toThrow(/command/i);
      await expect(
        manager.startHandoff("links", { ...request, title: "large" }, "p"),
      ).rejects.toThrow(/4 KB/);
      await expect(
        manager.startHandoff("links", { ...request, title: "declared" }, "p"),
      ).resolves.toMatchObject({ resume: { command: "resume" } });
      await expect(
        manager.startHandoff("links", { ...request, title: "t3:thread" }, "p"),
      ).resolves.toMatchObject({ link: "t3:thread" });
      await expect(
        manager.startHandoff(
          "links",
          { ...request, title: "https://example.test/thread" },
          "p",
        ),
      ).resolves.toMatchObject({ link: "https://example.test/thread" });
      const result = await manager.readHandoffStates(
        "links",
        {
          tool: "t3",
          handoffs: [{ id: "h", threadId: "t", folderId: "f", native: {} }],
        },
        "p",
      );
      await expect(
        manager.readHandoffStates(
          "links",
          {
            tool: "t3",
            handoffs: [
              { id: "h", threadId: "large", folderId: "f", native: {} },
            ],
          },
          "p",
        ),
      ).rejects.toThrow(/4 KB/);
      expect(result).toEqual([
        {
          id: "h",
          state: "ready",
          native: {},
          pullRequests: [{ url: "https://example.test/pr" }],
        },
      ]);
    } finally {
      await manager.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  },
);
