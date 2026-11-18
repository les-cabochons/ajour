import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { AppApiStorage } from "./storage.ts";
import { authenticateMcpRequest, createMcpClient } from "./mcp-clients.ts";

const directories: string[] = [];

async function tempStatePath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-mcp-clients-"));
  directories.push(directory);
  return path.join(directory, "state.json");
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("MCP clients", () => {
  it("starts with MCP off and no clients", async () => {
    const storage = new AppApiStorage(await tempStatePath());
    expect(await storage.getMcpSettings()).toEqual({
      enabled: false,
      clients: [],
    });
  });

  it("keeps MCP off for a state file written before MCP existed", async () => {
    const statePath = await tempStatePath();
    await writeFile(
      statePath,
      JSON.stringify({ version: 7, connections: [], pluginsEnabled: true }),
    );
    const storage = new AppApiStorage(statePath);
    expect((await storage.getMcpSettings()).enabled).toBe(false);
  });

  it("stores only the token's hash and authenticates with the token", async () => {
    const statePath = await tempStatePath();
    const storage = new AppApiStorage(statePath);
    const created = await createMcpClient(storage, "Claude Code on this Mac", {
      now: 1000,
    });

    const stateFile = await readFile(statePath, "utf8");
    expect(stateFile).not.toContain(created.token);
    expect(created.client).toEqual({
      id: created.client.id,
      name: "Claude Code on this Mac",
      createdAt: 1000,
    });

    const result = await authenticateMcpRequest(
      storage,
      `Bearer ${created.token}`,
      2000,
    );
    expect(result).toMatchObject({
      kind: "ok",
      client: { name: "Claude Code on this Mac" },
    });
    expect((await storage.getMcpSettings()).clients[0]?.lastUsedAt).toBe(2000);
  });

  it("tells a missing, an unknown and a revoked token apart", async () => {
    const storage = new AppApiStorage(await tempStatePath());
    const created = await createMcpClient(storage, "Codex", { now: 1000 });

    expect(await authenticateMcpRequest(storage, undefined)).toEqual({
      kind: "missing",
    });
    expect(
      await authenticateMcpRequest(storage, "Bearer ajour_not-a-token"),
    ).toEqual({ kind: "unknown" });

    expect(await storage.revokeMcpClient(created.client.id, 3000)).toBe(true);
    expect(
      await authenticateMcpRequest(storage, `Bearer ${created.token}`),
    ).toMatchObject({ kind: "revoked", client: { name: "Codex" } });
    expect((await storage.getMcpSettings()).clients).toEqual([]);
  });

  it("keeps a run's client limited to its tools, and a damaged list leaves it none", async () => {
    const statePath = await tempStatePath();
    const created = await createMcpClient(
      new AppApiStorage(statePath),
      "Enter in Workday run",
      { tools: ["get_week_changes"] },
    );
    const user = await createMcpClient(new AppApiStorage(statePath), "Codex");

    // Read back by a new storage, as after a restart.
    const authenticate = async (token: string) => {
      const result = await authenticateMcpRequest(
        new AppApiStorage(statePath),
        `Bearer ${token}`,
      );
      return result.kind === "ok" ? result.client : undefined;
    };
    expect((await authenticate(created.token))?.tools).toEqual([
      "get_week_changes",
    ]);
    expect(await authenticate(user.token)).not.toHaveProperty("tools");

    const state = JSON.parse(await readFile(statePath, "utf8"));
    // A name Ajour has no tool for is dropped, and the others stay.
    state.mcp.clients[0].tools = ["get_week_changes", "no_such_tool"];
    await writeFile(statePath, JSON.stringify(state));
    expect((await authenticate(created.token))?.tools).toEqual([
      "get_week_changes",
    ]);

    state.mcp.clients[0].tools = "every tool";
    await writeFile(statePath, JSON.stringify(state));
    expect((await authenticate(created.token))?.tools).toEqual([]);
  });
});

describe("a conversation's client", () => {
  const binding = { pullRequest: "pr-482", head: "a41c9e2" };

  it("drops a client whose pull request binding can't be read, rather than give it every tool", async () => {
    const statePath = await tempStatePath();
    const bound = await createMcpClient(
      new AppApiStorage(statePath),
      "Claude Code, pull request conversation",
      { pullRequest: binding },
    );
    const damaged = await createMcpClient(
      new AppApiStorage(statePath),
      "Codex, pull request conversation",
      { pullRequest: binding },
    );
    const missing = await createMcpClient(
      new AppApiStorage(statePath),
      "Codex, pull request conversation",
      { pullRequest: binding },
    );
    const user = await createMcpClient(new AppApiStorage(statePath), "Codex");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.mcp.clients[1].pullRequest = { pullRequest: 482, head: "a41c9e2" };
    state.mcp.clients[2].pullRequest = null;
    await writeFile(statePath, JSON.stringify(state));

    // Read back by a new storage, as after a restart, which revokes the
    // conversation clients it finds but keeps their binding.
    const authenticate = async (token: string) =>
      authenticateMcpRequest(new AppApiStorage(statePath), `Bearer ${token}`);
    expect(await authenticate(bound.token)).toMatchObject({
      kind: "revoked",
      client: { pullRequest: binding, tools: [] },
    });
    expect((await authenticate(damaged.token)).kind).toBe("unknown");
    expect((await authenticate(missing.token)).kind).toBe("unknown");
    expect((await authenticate(user.token)).kind).toBe("ok");
  });

  it("rebinds to a new head of its own pull request only", async () => {
    const storage = new AppApiStorage(await tempStatePath());
    const created = await createMcpClient(storage, "Claude Code", {
      pullRequest: binding,
    });
    const user = await createMcpClient(storage, "Codex");

    expect(
      await storage.rebindMcpClient(created.client.id, {
        ...binding,
        head: "c63e1f4",
      }),
    ).toBe(true);
    expect(
      await storage.rebindMcpClient(created.client.id, {
        pullRequest: "pr-485",
        head: "b52d0f3",
      }),
    ).toBe(false);
    expect(await storage.rebindMcpClient(user.client.id, binding)).toBe(false);

    const result = await authenticateMcpRequest(
      storage,
      `Bearer ${created.token}`,
    );
    expect(result).toMatchObject({
      kind: "ok",
      client: { pullRequest: { ...binding, head: "c63e1f4" } },
    });
  });

  it("revokes the conversation clients a restart finds, and keeps the others", async () => {
    const statePath = await tempStatePath();
    const before = new AppApiStorage(statePath);
    const leftover = await createMcpClient(before, "Claude Code", {
      pullRequest: binding,
    });
    const user = await createMcpClient(before, "Codex");

    const after = new AppApiStorage(statePath);
    const current = await createMcpClient(after, "Claude Code", {
      pullRequest: binding,
    });

    const kind = async (storage: AppApiStorage, token: string) =>
      (await authenticateMcpRequest(storage, `Bearer ${token}`)).kind;
    expect(await kind(after, leftover.token)).toBe("revoked");
    expect(await kind(after, user.token)).toBe("ok");
    expect(await kind(after, current.token)).toBe("ok");
    // Saved with the next write.
    expect(
      (await readFile(statePath, "utf8")).match(/"revokedAt"/g),
    ).toHaveLength(1);
  });
});
