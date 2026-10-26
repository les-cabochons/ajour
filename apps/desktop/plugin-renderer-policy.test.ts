import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
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
  strippedFileCount: () => number;
  forgetStrippedFiles: (packageDirectory: string) => Promise<void>;
  servePluginFile: (
    request: { url: string; method?: string },
    served: {
      pluginId: string;
      packageDirectory: string;
      hostDirectory: string;
      onSourceRefused?: (refusal: { file: string; reason: string }) => void;
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

describe("serving a plugin's TypeScript source", () => {
  let packageDirectory: string;
  let refused: { file: string; reason: string }[];

  beforeEach(async () => {
    packageDirectory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-plugin-ts-"),
    );
    refused = [];
    await mkdir(path.join(packageDirectory, "lib"));
  });

  afterEach(async () => {
    await policy.forgetStrippedFiles(packageDirectory);
    await rm(packageDirectory, { recursive: true, force: true });
  });

  const serve = (url: string) =>
    policy.servePluginFile(
      { url },
      {
        pluginId: "jira",
        packageDirectory,
        hostDirectory: packageDirectory,
        onSourceRefused: (refusal) => refused.push(refusal),
      },
    );

  it("serves a .ts or .mts file as JavaScript with its types stripped", async () => {
    const source = [
      'import { label } from "./label.ts";',
      "type Item = { title: string };",
      "export function title(item: Item): string {",
      "  return label(item.title as string);",
      "}",
    ].join("\n");
    await writeFile(path.join(packageDirectory, "lib", "plugin.ts"), source);
    await writeFile(
      path.join(packageDirectory, "lib", "label.mts"),
      "export const label = (text: string): string => text;",
    );

    for (const [url, expected] of [
      [
        "ajour-plugin://jira/lib/plugin.ts",
        [
          'import { label } from "./label.ts";',
          // Erased types keep every line and column.
          " ".repeat("type Item = { title: string };".length),
          "export function title(item      )         {",
          "  return label(item.title          );",
          "}",
        ].join("\n"),
      ],
      [
        "ajour-plugin://jira/lib/label.mts",
        "export const label = (text        )         => text;",
      ],
    ] as const) {
      const response = await serve(url);
      expect(response.status, url).toBe(200);
      expect(await response.text(), url).toBe(expected);
      expect(Object.fromEntries(response.headers), url).toEqual({
        "content-type": "text/javascript; charset=utf-8",
        "content-security-policy": policy.PLUGIN_CONTENT_SECURITY_POLICY,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      });
    }
    expect(refused).toEqual([]);
  });

  it("serves other files unchanged, whatever TypeScript they hold", async () => {
    const source = "export const answer: number = 42;";
    await writeFile(path.join(packageDirectory, "lib", "plugin.mjs"), source);
    await writeFile(path.join(packageDirectory, "notes.txt"), source);

    const module = await serve("ajour-plugin://jira/lib/plugin.mjs");
    const notes = await serve("ajour-plugin://jira/notes.txt");

    expect(await module.text()).toBe(source);
    expect(await notes.text()).toBe(source);
    expect(notes.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it.each([
    [
      "an enum",
      "export enum Status { Open, Closed }",
      "lib/status.ts uses TypeScript that Ajour can't strip: TypeScript enum is not supported in strip-only mode.",
    ],
    [
      "a namespace",
      "namespace Status { export const open = 1; }",
      "lib/status.ts uses TypeScript that Ajour can't strip: TypeScript namespace declaration is not supported in strip-only mode.",
    ],
    [
      "a parameter property",
      "export class Status { constructor(private open: boolean) {} }",
      "lib/status.ts uses TypeScript that Ajour can't strip: TypeScript parameter property is not supported in strip-only mode.",
    ],
    [
      "a syntax error",
      "export const open = ;",
      "lib/status.ts isn't valid TypeScript: Expression expected.",
    ],
  ])(
    "refuses a file with %s, naming it and why",
    async (_name, source, reason) => {
      await writeFile(path.join(packageDirectory, "lib", "status.ts"), source);

      const response = await serve("ajour-plugin://jira/lib/status.ts");

      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(source);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(refused).toEqual([{ file: "lib/status.ts", reason }]);
    },
  );

  it("serves a file's current source, whatever its size and time say", async () => {
    const file = path.join(packageDirectory, "lib", "plugin.ts");
    const installedAt = new Date("2026-10-01T12:00:00Z");
    await writeFile(file, "export const a: number = 1;");
    await utimes(file, installedAt, installedAt);
    const first = await (
      await serve("ajour-plugin://jira/lib/plugin.ts")
    ).text();

    // An update that keeps the size and the time, as a reproducible packer does.
    await writeFile(file, "export const b: number = 2;");
    await utimes(file, installedAt, installedAt);
    const replaced = await (
      await serve("ajour-plugin://jira/lib/plugin.ts")
    ).text();

    expect(first).toBe("export const a         = 1;");
    expect(replaced).toBe("export const b         = 2;");
  });

  it("serves the same output for a file that hasn't changed", async () => {
    await writeFile(
      path.join(packageDirectory, "lib", "plugin.ts"),
      "export const a: number = 1;",
    );

    const first = await serve("ajour-plugin://jira/lib/plugin.ts");
    const second = await serve("ajour-plugin://jira/lib/plugin.ts");

    expect(await second.text()).toBe(await first.text());
    expect(policy.strippedFileCount()).toBe(1);
  });

  it("forgets a package's stripped files on request, and no other's", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "ajour-plugin-ts-"));
    try {
      await writeFile(
        path.join(packageDirectory, "lib", "plugin.ts"),
        "export const a: number = 1;",
      );
      await writeFile(path.join(other, "plugin.ts"), "export const b = 2;");
      await serve("ajour-plugin://jira/lib/plugin.ts");
      await policy.servePluginFile(
        { url: "ajour-plugin://github/plugin.ts" },
        {
          pluginId: "github",
          packageDirectory: other,
          hostDirectory: other,
        },
      );
      const before = policy.strippedFileCount();

      await policy.forgetStrippedFiles(packageDirectory);

      expect(before).toBe(2);
      expect(policy.strippedFileCount()).toBe(1);
      await policy.forgetStrippedFiles(other);
      expect(policy.strippedFileCount()).toBe(0);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("forgets the stripped files of a package that is already gone", async () => {
    await writeFile(
      path.join(packageDirectory, "lib", "plugin.ts"),
      "export const a: number = 1;",
    );
    await serve("ajour-plugin://jira/lib/plugin.ts");
    await rm(packageDirectory, { recursive: true, force: true });

    await policy.forgetStrippedFiles(packageDirectory);

    expect(policy.strippedFileCount()).toBe(0);
  });

  it.each([".ts", ".mts"])(
    "strips a %s file of 2 MB, and refuses one a byte over, naming it",
    async (extension) => {
      const limit = 2 * 1024 * 1024;
      const header = "export const a: number = 1;\n//";
      const fits = `${header}${"x".repeat(limit - header.length)}`;
      await writeFile(path.join(packageDirectory, `fits${extension}`), fits);
      await writeFile(
        path.join(packageDirectory, `big${extension}`),
        `${fits}x`,
      );

      const served = await serve(`ajour-plugin://jira/fits${extension}`);
      const refusedResponse = await serve(
        `ajour-plugin://jira/big${extension}`,
      );

      expect(served.status).toBe(200);
      expect(refusedResponse.status).toBe(500);
      expect(refused).toEqual([
        {
          file: `big${extension}`,
          reason: `big${extension} is over 2 MB, the most Ajour strips in a TypeScript file.`,
        },
      ]);
    },
  );

  it("serves a large file that isn't TypeScript as it is", async () => {
    const big = `export const a = 1;\n//${"x".repeat(3 * 1024 * 1024)}`;
    await writeFile(path.join(packageDirectory, "big.mjs"), big);

    const response = await serve("ajour-plugin://jira/big.mjs");

    expect(response.status).toBe(200);
    expect((await response.text()).length).toBe(big.length);
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
