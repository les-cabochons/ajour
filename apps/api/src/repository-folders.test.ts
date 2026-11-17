import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
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
  await mkdir(path.join(root, "repo"));
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "data", "state.json"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
  });
  try {
    const posted = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/projects/p/repository-folders",
      body: JSON.stringify({ path: root }),
    });
    expect(posted.status).toBe(403);
    const folder = await addRepositoryFolderForServer(
      server,
      "p",
      path.join(root, "repo"),
    );
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
  ).toMatchObject({ version: 13, connections: [], repositoryFolders: [] });
});

it("Given a chosen folder, resolves its id after reload and refuses protected folders and junctions", async () => {
  // The resolver returns real paths: CI's temp folder is an 8.3 short name on
  // Windows (RUNNER~1) and a /var link to /private/var on macOS.
  const root = await fs.realpath(
    await mkdtemp(path.join(os.tmpdir(), "ajour-folders-")),
  );
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
  for (const forbidden of [root, data, install, path.join(data, "nested")])
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

it.each(["localhost", "127.0.0.1", "::1", "[::1]", hostname(), ".", "?"])(
  "Given a local UNC host %s, refuses before filesystem access",
  async (host) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-unc-"));
    roots.push(root);
    const resolver = new FolderResolver(
      new AppApiStorage(path.join(root, "state.json")),
      { userData: root, install: root },
    );
    await expect(
      resolver.addFromChooser("p", `\\\\${host}\\C$\\private`),
    ).rejects.toThrow("Ajour");
  },
);
it("Given a moved folder, reports a stable error without the path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-gone-"));
  roots.push(root);
  const repo = path.join(root, "PRIVATE-CANARY");
  await mkdir(repo);
  const resolver = new FolderResolver(
    new AppApiStorage(path.join(root, "state.json")),
    { userData: path.join(root, "data"), install: path.join(root, "install") },
  );
  const folder = await resolver.addFromChooser("p", repo);
  await rm(repo, { recursive: true });
  await expect(resolver.resolve(folder.id, "p")).rejects.toMatchObject({
    code: "folder_unavailable",
    message: "This repository folder is no longer available.",
  });
});

it("Given one malformed saved record, reload keeps the other folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-normalize-"));
  roots.push(root);
  const statePath = path.join(root, "state.json");
  const valid = { id: "valid", projectId: "p", name: "repo", path: root };
  await writeFile(
    statePath,
    JSON.stringify({
      version: 11,
      connections: [],
      repositoryFolders: [valid, { id: "bad" }],
    }),
  );
  expect(await new AppApiStorage(statePath).listRepositoryFolders("p")).toEqual(
    [valid],
  );
});

it("Given an alias whose realpath keeps its spelling, refuses the protected directory by file identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-identity-"));
  roots.push(root);
  const data = path.join(root, "data");
  const alias = path.join(root, "alias");
  await mkdir(data);
  await symlink(data, alias, "junction");
  const real = fs.realpath;
  const spy = vi
    .spyOn(fs, "realpath")
    .mockImplementation(async (value, ...options) =>
      value === alias ? alias : real(value, ...options),
    );
  try {
    const resolver = new FolderResolver(
      new AppApiStorage(path.join(data, "state.json")),
      { userData: data },
    );
    await expect(resolver.addFromChooser("p", alias)).rejects.toThrow("Ajour");
  } finally {
    spy.mockRestore();
  }
});
it.each(["EACCES", "ENOTDIR"])(
  "Given %s from the filesystem, returns a stable error without content",
  async (code) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-error-"));
    roots.push(root);
    const resolver = new FolderResolver(
      new AppApiStorage(path.join(root, "state.json")),
      {},
    );
    const spy = vi
      .spyOn(fs, "stat")
      .mockRejectedValueOnce(
        Object.assign(new Error("PRIVATE-CANARY"), { code }),
      );
    try {
      await expect(resolver.addFromChooser("p", root)).rejects.toMatchObject({
        code: code === "EACCES" ? "folder_access_denied" : "folder_unavailable",
        message:
          code === "EACCES"
            ? "This repository folder cannot be accessed."
            : "This repository folder is no longer available.",
      });
    } finally {
      spy.mockRestore();
    }
  },
);

it("Given a saved folder id without project context, resolves it but still checks a supplied project", async () => {
  const root = await fs.realpath(
    await mkdtemp(path.join(os.tmpdir(), "ajour-folder-context-")),
  );
  roots.push(root);
  const resolver = new FolderResolver(
    new AppApiStorage(path.join(root, "data", "state.json")),
    {},
  );
  const folder = await resolver.addFromChooser("project", root);
  expect(await resolver.resolve(folder.id)).toBe(root);
  await expect(resolver.resolve(folder.id, "other")).rejects.toThrow();
  await expect(resolver.resolve(folder.id, "")).rejects.toThrow();
  await expect(resolver.resolve("unknown")).rejects.toThrow();
});
