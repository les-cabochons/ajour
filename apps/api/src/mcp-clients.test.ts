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
    state.mcp.clients[0].tools = "every tool";
    await writeFile(statePath, JSON.stringify(state));
    expect((await authenticate(created.token))?.tools).toEqual([]);
  });
});
