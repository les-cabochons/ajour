import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const policy = require("./electron/plugin-renderer-policy.cjs") as {
  PLUGIN_CONTENT_SECURITY_POLICY: string;
  pluginOrigin: (pluginId: string) => string;
  pluginPartition: (pluginId: string) => string;
  pluginRequestAllowed: (url: string, pluginId: string) => boolean;
  resolvePluginFile: (
    url: string,
    pluginId: string,
    packageDirectory: string,
  ) =>
    | { kind: "host"; file: string }
    | { kind: "package"; filePath: string }
    | { kind: "refused" };
  servePluginFile: (
    request: { url: string; method?: string },
    served: {
      pluginId: string;
      packageDirectory: string;
      hostDirectory: string;
    },
  ) => Promise<Response>;
  pluginOfSender: (
    event: unknown,
    registeredPluginOf: (webContentsId: number) => string | undefined,
  ) => string | undefined;
};

describe("a plugin's origin and session", () => {
  it("names the origin after the plugin, and keeps its partition in memory", () => {
    expect(policy.pluginOrigin("jira")).toBe("ajour-plugin://jira");
    expect(policy.pluginPartition("jira")).toBe("ajour-plugin:jira");
    expect(policy.pluginPartition("jira")).not.toMatch(/^persist:/);
  });

  it("lets through only requests for the plugin's own files", () => {
    const allowed = (url: string) => policy.pluginRequestAllowed(url, "jira");

    expect(allowed("ajour-plugin://jira/.ajour/host.html")).toBe(true);
    expect(allowed("ajour-plugin://jira/lib/plugin.mjs")).toBe(true);
    for (const url of [
      "ajour-plugin://github/plugin.mjs",
      "ajour-plugin://jira.evil/plugin.mjs",
      "ajour-plugin://user:pw@jira/plugin.mjs",
      "https://jira.example.com/",
      "http://127.0.0.1:8787/api/plugins",
      "ws://127.0.0.1:8787/",
      "file:///C:/Users/alex/AppData/Roaming/Ajour/app-api-state.json",
      "app://local/index.html",
      "data:text/javascript,1",
      "blob:ajour-plugin://jira/1234",
      "devtools://devtools/bundled/inspector.html",
      "not a url",
    ]) {
      expect(allowed(url), url).toBe(false);
    }
  });

  it("holds every file to a policy with no connection, frame or object", () => {
    expect(policy.PLUGIN_CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; worker-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });
});

describe("which file a plugin's origin serves", () => {
  const packageDirectory = path.resolve("/plugins/jira");
  const resolve = (url: string) =>
    policy.resolvePluginFile(url, "jira", packageDirectory);

  it("serves Ajour's own files under /.ajour/, which the package can't replace", () => {
    expect(resolve("ajour-plugin://jira/.ajour/host.html")).toEqual({
      kind: "host",
      file: "host.html",
    });
    expect(resolve("ajour-plugin://jira/.ajour/worker.js")).toEqual({
      kind: "host",
      file: "worker.js",
    });
    expect(resolve("ajour-plugin://jira/.ajour/other.js")).toEqual({
      kind: "refused",
    });
  });

  it("serves a package file by its path inside the package", () => {
    expect(resolve("ajour-plugin://jira/lib/plugin.mjs")).toEqual({
      kind: "package",
      filePath: path.join(packageDirectory, "lib", "plugin.mjs"),
    });
    expect(resolve("ajour-plugin://jira/lib/my%20plugin.mjs")).toEqual({
      kind: "package",
      filePath: path.join(packageDirectory, "lib", "my plugin.mjs"),
    });
  });

  it("keeps a path that climbs above the root inside the package, as a URL does", () => {
    for (const url of [
      "ajour-plugin://jira/../github/plugin.mjs",
      "ajour-plugin://jira/%2e%2e/github/plugin.mjs",
    ]) {
      expect(resolve(url)).toEqual({
        kind: "package",
        filePath: path.join(packageDirectory, "github", "plugin.mjs"),
      });
    }
  });

  it.each([
    "ajour-plugin://jira/lib/..%2f..%2fgithub/plugin.mjs",
    "ajour-plugin://jira/lib%5c..%5c..%5cgithub%5cplugin.mjs",
    "ajour-plugin://jira/C:%5cWindows%5cwin.ini",
    "ajour-plugin://jira/plugin.mjs:stream",
    "ajour-plugin://jira/plugin%00.mjs",
    "ajour-plugin://jira/lib//plugin.mjs",
    "ajour-plugin://jira/%E0%A4%A",
    "ajour-plugin://jira/",
    "ajour-plugin://github/plugin.mjs",
  ])("refuses %s", (url) => {
    expect(resolve(url)).toEqual({ kind: "refused" });
  });
});

describe("serving a plugin's files", () => {
  let root: string;
  let packageDirectory: string;
  let hostDirectory: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ajour-plugin-files-"));
    packageDirectory = path.join(root, "jira");
    hostDirectory = path.join(root, "host");
    await mkdir(path.join(packageDirectory, "lib"), { recursive: true });
    await mkdir(hostDirectory);
    await writeFile(
      path.join(packageDirectory, "lib", "plugin.mjs"),
      "export {};",
    );
    await writeFile(path.join(packageDirectory, "page.html"), "<p>hi</p>");
    await writeFile(path.join(root, "secret.txt"), "not the plugin's");
    await writeFile(path.join(hostDirectory, "worker.js"), "// bootstrap");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const serve = (url: string, method?: string) =>
    policy.servePluginFile(
      { url, ...(method ? { method } : {}) },
      { pluginId: "jira", packageDirectory, hostDirectory },
    );

  it("serves a module as JavaScript, with the policy, uncached and unsniffed", async () => {
    const response = await serve("ajour-plugin://jira/lib/plugin.mjs");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("export {};");
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "text/javascript; charset=utf-8",
      "content-security-policy": policy.PLUGIN_CONTENT_SECURITY_POLICY,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    });
  });

  it("serves Ajour's bootstrap from its own folder", async () => {
    const response = await serve("ajour-plugin://jira/.ajour/worker.js");

    expect(await response.text()).toBe("// bootstrap");
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
  });

  it("never serves a package's file named host.html as Ajour's page", async () => {
    await writeFile(path.join(packageDirectory, "host.html"), "<p>mine</p>");

    const response = await serve("ajour-plugin://jira/host.html");

    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
  });

  it("serves Ajour's own page as a page", async () => {
    await writeFile(path.join(hostDirectory, "host.html"), "<p>ajour</p>");

    const response = await serve("ajour-plugin://jira/.ajour/host.html");

    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("never serves a package's page as a page", async () => {
    const response = await serve("ajour-plugin://jira/page.html");

    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
  });

  it("answers 404 for a missing file, a folder, another method or a path out of the package", async () => {
    for (const [url, method] of [
      ["ajour-plugin://jira/lib/missing.mjs"],
      ["ajour-plugin://jira/lib"],
      ["ajour-plugin://jira/lib/plugin.mjs", "POST"],
      ["ajour-plugin://jira/../secret.txt"],
      ["ajour-plugin://jira/%2e%2e/secret.txt"],
    ] as const) {
      const response = await serve(url, method);
      expect(response.status, url).toBe(404);
      expect(response.headers.get("content-security-policy")).toBe(
        policy.PLUGIN_CONTENT_SECURITY_POLICY,
      );
    }
  });

  it("answers 404 for a link that leads out of the package", async () => {
    try {
      await symlink(
        path.join(root, "secret.txt"),
        path.join(packageDirectory, "lib", "escape.txt"),
      );
    } catch {
      // Windows needs a privilege for file links; a junction stands in.
      await symlink(root, path.join(packageDirectory, "lib", "up"), "junction");
    }
    for (const url of [
      "ajour-plugin://jira/lib/escape.txt",
      "ajour-plugin://jira/lib/up/secret.txt",
    ]) {
      expect((await serve(url)).status, url).toBe(404);
    }
  });
});

describe("who an IPC call comes from", () => {
  const mainFrame = {
    detached: false,
    parent: null,
    origin: "ajour-plugin://jira",
    processId: 4,
    routingId: 1,
  };
  const registered = (id: number) => (id === 7 ? "jira" : undefined);
  const call = (overrides: Record<string, unknown> = {}) => ({
    sender: { id: 7, mainFrame },
    senderFrame: mainFrame,
    ...overrides,
  });

  it("is the plugin whose registered page's main frame sent it, on its origin", () => {
    expect(policy.pluginOfSender(call(), registered)).toBe("jira");
  });

  it("is nobody for a subframe, even on the plugin's origin", () => {
    const subframe = { ...mainFrame, parent: mainFrame };
    expect(
      policy.pluginOfSender(call({ senderFrame: subframe }), registered),
    ).toBeUndefined();
  });

  it("knows the page's main frame when Electron hands it over as another object", () => {
    expect(
      policy.pluginOfSender(
        call({ senderFrame: { ...mainFrame } }),
        registered,
      ),
    ).toBe("jira");
  });

  it("is nobody for a frame that isn't the page's main frame", () => {
    for (const other of [
      { ...mainFrame, routingId: 2 },
      { ...mainFrame, processId: 5 },
    ]) {
      expect(
        policy.pluginOfSender(call({ senderFrame: other }), registered),
      ).toBeUndefined();
    }
    expect(
      policy.pluginOfSender(call({ sender: { id: 7 } }), registered),
    ).toBeUndefined();
  });

  it("is nobody for a detached frame, or one already gone", () => {
    const detached = { ...mainFrame, detached: true };
    expect(
      policy.pluginOfSender(
        call({
          sender: { id: 7, mainFrame: detached },
          senderFrame: detached,
        }),
        registered,
      ),
    ).toBeUndefined();
    expect(
      policy.pluginOfSender(call({ senderFrame: null }), registered),
    ).toBeUndefined();
    const gone = {
      get detached(): boolean {
        throw new Error(
          "Render frame was disposed before WebFrameMain could be accessed",
        );
      },
    };
    expect(
      policy.pluginOfSender(call({ senderFrame: gone }), registered),
    ).toBeUndefined();
  });

  it("is nobody for a page on another plugin's origin, or one Ajour didn't register", () => {
    const github = { ...mainFrame, origin: "ajour-plugin://github" };
    expect(
      policy.pluginOfSender(
        call({ sender: { id: 7, mainFrame: github }, senderFrame: github }),
        registered,
      ),
    ).toBeUndefined();
    expect(
      policy.pluginOfSender(call({ sender: { id: 8, mainFrame } }), registered),
    ).toBeUndefined();
    const window = { ...mainFrame, origin: "app://local" };
    expect(
      policy.pluginOfSender(
        call({ sender: { id: 1, mainFrame: window }, senderFrame: window }),
        registered,
      ),
    ).toBeUndefined();
  });

  it("never takes the plugin from what the call says", () => {
    expect(
      policy.pluginOfSender(
        { ...call(), pluginId: "github", origin: "ajour-plugin://github" },
        registered,
      ),
    ).toBe("jira");
  });
});
