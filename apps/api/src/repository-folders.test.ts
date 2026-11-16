import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { FolderResolver } from "./repository-folders.ts";
import { AppApiStorage } from "./storage.ts";
import { runStateMigrations } from "./state-migrations.ts";
import {
  createAppApiServer,
  addRepositoryFolderForServer,
  stopAppApiServer,
} from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

const roots: string[] = [];
it("Given a window, paths cannot be posted; main adds a folder and the window can list and remove it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-folder-routes-"));
  roots.push(root);
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "data", "state.json"),
  });
  try {
    const posted = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/projects/p/repository-folders",
      body: JSON.stringify({ path: root }),
    });
    expect(posted.status).toBe(403);
    const folder = await addRepositoryFolderForServer(server, "p", root, {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    });
    expect(
      (
        await dispatchJsonRequest(server, {
          method: "GET",
          path: "/api/projects/p/repository-folders",
        })
      ).body,
    ).toEqual([folder]);
    const used = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/projects/p/repository-folders/${folder.id}/use`,
    });
    expect(used.status).toBe(200);
    expect(used.body).toEqual([{ ...folder, lastUsedAt: expect.any(Number) }]);
    expect(
      (
        await dispatchJsonRequest(server, {
          method: "GET",
          path: "/api/projects/other/repository-folders",
        })
      ).body,
    ).toEqual([]);
    expect(
      (
        await dispatchJsonRequest(server, {
          method: "DELETE",
          path: `/api/projects/p/repository-folders/${folder.id}`,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await dispatchJsonRequest(server, {
          method: "GET",
          path: "/api/projects/p/repository-folders",
        })
      ).body,
    ).toEqual([]);
  } finally {
    await stopAppApiServer(server);
  }
});
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("Given version 10, migration adds local folders without changing connections", async () => {
  expect(
    await runStateMigrations({ version: 10, connections: [] }, 10),
  ).toMatchObject({ version: 11, connections: [], repositoryFolders: [] });
});

it("Given a chosen folder, resolves its id after reload and refuses protected folders and junctions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-folders-"));
  roots.push(root);
  const data = path.join(root, "data"),
    install = path.join(root, "install"),
    repo = path.join(root, "repo");
  for (const folder of [data, install, repo, path.join(data, "nested")])
    await mkdir(folder, { recursive: true });
  const store = new AppApiStorage(path.join(data, "state.json"));
  const resolver = new FolderResolver(store, { userData: data, install });
  const folder = await resolver.addFromChooser("project", repo);
  expect(await resolver.resolve(folder.id, "project")).toBe(repo);
  expect(await resolver.addFromChooser("project", repo)).toEqual(folder);
  await expect(resolver.resolve(folder.id, "other")).rejects.toThrow();
  const reloaded = new AppApiStorage(path.join(data, "state.json"));
  expect(await reloaded.listRepositoryFolders("project")).toEqual([folder]);
  for (const forbidden of [data, install, path.join(data, "nested")])
    await expect(resolver.addFromChooser("project", forbidden)).rejects.toThrow(
      "Ajour",
    );
  const alias = path.join(root, "alias");
  await symlink(data, alias, "junction");
  await expect(resolver.addFromChooser("project", alias)).rejects.toThrow(
    "Ajour",
  );
  await rm(repo, { recursive: true });
  await symlink(data, repo, "junction");
  await expect(resolver.resolve(folder.id, "project")).rejects.toThrow("Ajour");
  await store.removeRepositoryFolder("project", folder.id);
  await expect(resolver.resolve(folder.id, "project")).rejects.toThrow();
});
