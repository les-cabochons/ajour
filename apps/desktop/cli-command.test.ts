import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { macosLinkFixture } from "./fake-macos-command-link.ts";
import { recordingEvents } from "./recording-events.ts";

/*
 * Installing the ajour command from Settings (#568, spec #567). The
 * controller resolves the release of the app's own version, downloads its
 * archive within the URL and size rules, checks its SHA-256, unpacks it with
 * the system tar, checks `ajour -V`, moves it into the install folder, puts
 * the folder on the PATH and writes the record. Any failure leaves what was
 * installed before.
 *
 * GitHub, tar, the binary and the PATH are fakes; the files are real, in a
 * temp folder. The real-app check, scripts/check-cli-command.mjs, runs the
 * real ones.
 */

const require = createRequire(import.meta.url);

type CliState = {
  status:
    "unsupported" | "not-installed" | "installing" | "installed" | "error";
  version?: string;
  binaryPath?: string;
  location?: string;
  phase?: "downloading" | "checking" | "linking";
  progress: number | null;
  error: string | null;
  reason?: "development_build" | "unsupported_platform";
  newlyInstalled?: boolean;
};
type Controller = {
  state(): Promise<CliState>;
  install(options?: { unit?: unknown }): Promise<CliState>;
  reconcile(): Promise<CliState>;
  stop(timeoutMs?: number): Promise<void>;
  onChange(listener: (state: CliState) => void): () => void;
};
type RegistryValue = { value: string | null; kind: string | null };
type Registry = {
  read(): Promise<RegistryValue>;
  write(change: {
    expected: string | null;
    expectedKind: string | null;
    value: string | null;
    kind: string | null;
  }): Promise<boolean>;
  broadcast(): Promise<void>;
};
type UserPath = {
  add(folder: string, hooks?: unknown): Promise<unknown>;
  remove(folder: string): Promise<unknown>;
};

const { createCliCommandController, cliAssetName } =
  require("./electron/cli-command.cjs") as {
    createCliCommandController: (
      options: Record<string, unknown>,
    ) => Controller;
    cliAssetName: (
      platform: string,
      arch: string,
      version: string,
    ) => string | null;
  };
const { createWindowsUserPath } = require("./electron/cli-path.cjs") as {
  createWindowsUserPath: (options: {
    registry: Registry;
    env?: Record<string, string | undefined>;
  }) => UserPath;
};

const VERSION = "0.0.1-nightly.20261104.294";
const TAG = `v${VERSION}`;
const ASSET = `ajour-${VERSION}-windows-x64.zip`;
const API = `https://api.github.com/repos/les-cabochons/ajour/releases/tags/${TAG}`;
const DOWNLOAD = `https://github.com/les-cabochons/ajour/releases/download/${TAG}/${ASSET}`;
const TAR = "C:\\Windows\\System32\\tar.exe";
/** Where GitHub redirects a release download. */
const ASSET_HOST = "https://release-assets.githubusercontent.com/x";

/** What the fake tar finds in an archive: its entries and their bytes. */
type Archive = Record<string, string | null>;
const goodArchive = (version = VERSION): Archive => ({
  "./": null,
  "./ajour.exe": `binary ${version}`,
  "./man/": null,
  "./man/man1/": null,
  "./man/man1/ajour.1": "manual",
  "./completions/": null,
  "./completions/ajour.bash": "complete -F _ajour ajour",
});

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

let root: string;
let installDir: string;
let recordFile: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-command-"));
  installDir = path.join(root, "Local", "Ajour", "bin");
  recordFile = path.join(root, "userData", "cli-command.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * A release of `version` serving `archive`. The archive's bytes are its JSON,
 * so the fake tar can read back what a download wrote. As GitHub does, the
 * release page's download redirects to the asset host, here to
 * `download.redirect`. Like Electron's adapter, the fake never follows a
 * redirect: it answers it, and the controller follows.
 */
function fakeGithub({
  archive = goodArchive(),
  asset = {},
  release = {},
  download = {},
}: {
  archive?: Archive;
  asset?: Record<string, unknown>;
  release?: Record<string, unknown> | null;
  download?: {
    redirect?: string;
    status?: number;
    extraBytes?: number;
    hold?: Promise<void>;
  };
} = {}) {
  const bytes = Buffer.from(JSON.stringify(archive));
  const served = Buffer.concat([
    bytes,
    Buffer.alloc(download.extraBytes ?? 0, 1),
  ]);
  const requests: string[] = [];
  const inits: Array<{ redirect?: string } | undefined> = [];
  const redirectTo = download.redirect ?? ASSET_HOST;
  const fetch = async (
    url: string,
    init?: { redirect?: string; signal?: AbortSignal },
  ) => {
    requests.push(url);
    inits.push(init);
    if (url.includes("/releases/tags/")) {
      if (release === null) return response(404, url, Buffer.from("{}"));
      return response(
        200,
        url,
        Buffer.from(
          JSON.stringify({
            tag_name: TAG,
            assets: [
              {
                name: ASSET,
                size: bytes.byteLength,
                digest: `sha256:${sha256(bytes)}`,
                browser_download_url: DOWNLOAD,
                ...asset,
              },
            ],
            ...release,
          }),
        ),
      );
    }
    if (url !== redirectTo) {
      return response(302, url, Buffer.alloc(0), { location: redirectTo });
    }
    return response(
      download.status ?? 200,
      url,
      served,
      {},
      { signal: init?.signal, hold: download.hold },
    );
  };
  return { fetch, requests, inits, bytes };
}

function response(
  status: number,
  url: string,
  body: Buffer,
  headers: Record<string, string> = {},
  { signal, hold }: { signal?: AbortSignal; hold?: Promise<void> } = {},
) {
  const third = Math.max(1, Math.ceil(body.byteLength / 3));
  let start = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(body.toString("utf8")),
    // Three chunks, so a download reports progress. As Electron's does,
    // the body fails when the request's signal aborts. `hold` keeps the
    // second chunk back until it settles.
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () =>
          controller.error(signal.reason),
        );
      },
      async pull(controller) {
        if (start > 0 && hold) await hold;
        if (signal?.aborted) return;
        if (start >= body.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(body.subarray(start, start + third)));
        start += third;
      },
    }),
  };
}

/** The system's tar and the downloaded binary, as fakes. */
function fakeExec({
  versionOutput,
  listing,
}: {
  versionOutput?: (binary: string) => Promise<string> | string;
  listing?: string[];
} = {}) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const exec = async (
    file: string,
    args: string[],
    _options?: { timeout?: number },
  ) => {
    calls.push({ file, args });
    if (file === TAR) {
      // `-tf ARCHIVE` lists it, `-xf ARCHIVE -C FOLDER` unpacks it.
      const archive = JSON.parse(await readFile(args[1]!, "utf8")) as Archive;
      if (args[0] === "-tf") {
        return {
          stdout: `${(listing ?? Object.keys(archive)).join("\r\n")}\r\n`,
        };
      }
      const into = args[args.indexOf("-C") + 1]!;
      for (const [name, content] of Object.entries(archive)) {
        const target = path.join(into, name);
        if (content === null) await mkdir(target, { recursive: true });
        else {
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, content);
        }
      }
      return { stdout: "" };
    }
    // The binary: it prints the version it was built with.
    const output = versionOutput
      ? await versionOutput(file)
      : `ajour ${(await readFile(file, "utf8")).replace("binary ", "")}\n`;
    return { stdout: output };
  };
  return { exec, calls };
}

/** A step that changes a file or the Path, which an interruption can cut. */
type Gate = <T>(
  name: string,
  args: unknown[],
  run: () => Promise<T>,
) => Promise<T>;

/**
 * The real user Path module over a fake registry: the user Path starts as
 * `initial`, REG_SZ unless given. `fail` throws before writing,
 * `failBroadcast` after it. `gate` wraps each write and broadcast.
 */
function fakeLink({
  initial = { value: "C:\\Tools", kind: "String" },
  fail = false,
  failBroadcast = false,
  gate,
  env = {},
}: {
  env?: Record<string, string>;
  initial?: RegistryValue;
  fail?: boolean;
  failBroadcast?: boolean;
  gate?: Gate;
} = {}) {
  let current = { ...initial };
  const writes: RegistryValue[] = [];
  const registry: Registry = {
    async read() {
      return { ...current };
    },
    async write({ expected, expectedKind, value, kind }) {
      if (fail) throw new Error("PowerShell exited with 1.");
      if (current.value !== expected || current.kind !== expectedKind)
        return false;
      current = value === null ? { value: null, kind: null } : { value, kind };
      writes.push({ ...current });
      return true;
    },
    async broadcast() {
      if (failBroadcast) throw new Error("Add-Type failed.");
    },
  };
  const gated: Registry = gate
    ? {
        read: registry.read,
        write: (change) =>
          gate("registry.write", [change], () => registry.write(change)),
        broadcast: () =>
          gate("registry.broadcast", [], () => registry.broadcast()),
      }
    : registry;
  return {
    link: createWindowsUserPath({ registry: gated, env }),
    writes,
    initial,
    current: () => current,
    /** The same user Path, as the next launch of Ajour sees it. */
    nextLaunch: () => createWindowsUserPath({ registry, env: {} }),
  };
}

/** `fs` with some of its functions replaced. */
function fsWith(replaced: Record<string, (...args: never[]) => unknown>) {
  return { ...fs, ...replaced } as typeof fs;
}

/**
 * Cuts the install at the first step `cutHere` picks, as if Ajour quit or
 * crashed there: that step and everything after it never happen. The steps
 * are each call that changes a file, and each write and broadcast of the
 * Path.
 */
function interruption(
  cutHere: (step: { name: string; args: unknown[]; index: number }) => boolean,
) {
  let index = 0;
  let cut = false;
  let reached!: () => void;
  const cutReached = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate: Gate = (name, args, run) => {
    if (cut || cutHere({ name, args, index: ++index })) {
      cut = true;
      reached();
      return new Promise<never>(() => {});
    }
    return run();
  };
  const changing = ["mkdir", "rm", "rename", "writeFile", "open"] as const;
  const gatedFs = fsWith(
    Object.fromEntries(
      changing.map((name) => [
        name,
        (...args: unknown[]) =>
          gate(name, args, () =>
            (fs[name] as (...a: unknown[]) => Promise<unknown>)(...args),
          ),
      ]),
    ),
  );
  return { gate, fs: gatedFs, cutReached, steps: () => index };
}

function controllerWith({
  github = fakeGithub(),
  exec = fakeExec(),
  link = fakeLink(),
  files = fs,
  platform = "win32",
  arch = "x64",
  appVersion = VERSION,
  development = false,
  releaseOrigin,
  allowAdHocSignature,
}: {
  github?: ReturnType<typeof fakeGithub>;
  exec?: ReturnType<typeof fakeExec>;
  link?: { link: UserPath };
  files?: typeof fs;
  platform?: string;
  arch?: string;
  appVersion?: string;
  development?: boolean;
  releaseOrigin?: string;
  allowAdHocSignature?: boolean;
} = {}) {
  const controller = createCliCommandController({
    fetch: github.fetch,
    fs: files,
    exec: exec.exec,
    platform,
    arch,
    appVersion,
    development,
    releaseOrigin,
    allowAdHocSignature,
    paths: { installDir, recordFile, tar: TAR },
    link: link.link,
    now: () => Date.parse("2026-11-04T10:00:00Z"),
  });
  return { controller, github, exec, link };
}

/** Every file under `folder`, relative, with `/` separators. */
async function filesUnder(folder: string): Promise<string[]> {
  if (!existsSync(folder)) return [];
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(folder, path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/"),
    )
    .sort();
}

/** Installs `version` as a previous install would have left it. */
async function installedBefore(version: string) {
  const archive = goodArchive(version);
  archive["./man/man1/ajour.1"] = "old manual";
  const asset = `ajour-${version}-windows-x64.zip`;
  const github = fakeGithub({
    archive,
    asset: {
      name: asset,
      browser_download_url: `https://github.com/les-cabochons/ajour/releases/download/v${version}/${asset}`,
    },
  });
  const { controller } = controllerWith({ appVersion: version, github });
  expect((await controller.install()).status).toBe("installed");
  return JSON.parse(await readFile(recordFile, "utf8"));
}

describe("the asset of each platform", () => {
  it.each([
    ["win32", "x64", `ajour-${VERSION}-windows-x64.zip`],
    ["darwin", "arm64", `ajour-${VERSION}-macos-arm64.tar.gz`],
    ["darwin", "x64", `ajour-${VERSION}-macos-x64.tar.gz`],
    ["win32", "arm64", `ajour-${VERSION}-windows-arm64.zip`],
    ["linux", "x64", null],
  ])("%s %s is %s", (platform, arch, name) => {
    expect(cliAssetName(platform, arch, VERSION)).toBe(name);
  });
});

describe("installing the ajour command", () => {
  it("is not installed at first", async () => {
    const { controller } = controllerWith();

    expect(await controller.state()).toEqual({
      status: "not-installed",
      progress: null,
      error: null,
    });
  });

  it("downloads, checks and installs the app's own version, then puts it on the PATH", async () => {
    const { controller, github, exec, link } = controllerWith();

    const state = await controller.install();

    expect(github.requests).toEqual([API, DOWNLOAD, ASSET_HOST]);
    expect(state).toEqual({
      status: "installed",
      version: VERSION,
      binaryPath: path.join(installDir, "ajour.exe"),
      location: installDir,
      progress: null,
      error: null,
      newlyInstalled: true,
    });
    expect(await filesUnder(installDir)).toEqual([
      "ajour.exe",
      "share/completions/ajour.bash",
      "share/man/man1/ajour.1",
    ]);
    expect(link.current()).toEqual({
      value: `C:\\Tools;${installDir}`,
      kind: "String",
    });
    // The check ran the unpacked binary, before it moved into place.
    const check = exec.calls.find((call) => call.args[0] === "-V")!;
    expect(check.file).not.toBe(path.join(installDir, "ajour.exe"));
    expect(JSON.parse(await readFile(recordFile, "utf8"))).toMatchObject({
      version: VERSION,
      binaryPath: path.join(installDir, "ajour.exe"),
      installedAt: "2026-11-04T10:00:00.000Z",
    });
  }, 30_000);

  it("follows each redirect itself, so it sees where it leads", async () => {
    const { controller, github } = controllerWith();

    await controller.install();

    expect(github.inits.every((init) => init?.redirect === "manual")).toBe(
      true,
    );
  });

  it("unpacks with the system tar by its absolute path", async () => {
    const { controller, exec } = controllerWith();

    await controller.install();

    const tars = exec.calls.filter((call) => call.file === TAR);
    expect(tars.map((call) => call.args[0])).toEqual(["-tf", "-xf"]);
  });

  it("reports each phase, and the download's progress, as it goes", async () => {
    const { controller } = controllerWith();
    const seen: CliState[] = [];
    controller.onChange((state) => seen.push(state));

    await controller.install();

    const downloading = seen.filter((state) => state.phase === "downloading");
    const percents = downloading.map((state) => state.progress!);
    // The fake serves three chunks: 0%, then one step per chunk.
    expect(percents).toHaveLength(4);
    expect(percents[0]).toBe(0);
    expect(percents.at(-1)).toBe(100);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    expect(new Set(percents).size).toBe(4);
    expect(
      seen
        .slice(downloading.length)
        .map((state) => state.phase ?? state.status),
    ).toEqual(["checking", "linking", "installed"]);
  });

  it("reads the installed version back from the record", async () => {
    await controllerWith().controller.install();

    // A later launch: a new controller reads the record.
    const { controller } = controllerWith();
    expect(await controller.state()).toEqual({
      status: "installed",
      version: VERSION,
      binaryPath: path.join(installDir, "ajour.exe"),
      location: installDir,
      progress: null,
      error: null,
    });
  });

  it("trusts the record only while its binary exists", async () => {
    await controllerWith().controller.install();
    await rm(path.join(installDir, "ajour.exe"));

    const { controller } = controllerWith();
    expect((await controller.state()).status).toBe("not-installed");
  });

  it("replaces an older install and leaves no old files behind", async () => {
    await installedBefore("0.0.1-nightly.20261101.280");
    const { controller } = controllerWith();

    const state = await controller.install();

    expect(state.version).toBe(VERSION);
    expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
      `binary ${VERSION}`,
    );
    expect(await filesUnder(installDir)).toEqual([
      "ajour.exe",
      "share/completions/ajour.bash",
      "share/man/man1/ajour.1",
    ]);
  });

  it("runs one install at a time", async () => {
    const { controller, github } = controllerWith();

    const [first, second] = await Promise.all([
      controller.install(),
      controller.install(),
    ]);

    expect(first).toEqual(second);
    expect(github.requests).toEqual([API, DOWNLOAD, ASSET_HOST]);
  });

  it("records the install on its event", async () => {
    const { events, recorded } = recordingEvents();
    const { controller } = controllerWith();

    await events.run(
      "cli_command.install",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.install({ unit }),
    );

    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.install",
    )!;
    expect(event.outcome).toBe("ok");
    expect(event.cli_command).toMatchObject({
      version: VERSION,
      platform: "win32",
      arch: "x64",
      result: "installed",
      path_added: true,
    });
    // No path, which holds the user name.
    expect(JSON.stringify(event)).not.toContain(root.replaceAll("\\", "\\\\"));
  });
});

describe("a refused or failed install", () => {
  /** Installs, and checks that nothing new is on disk or on the PATH. */
  async function refused(
    setup: Parameters<typeof controllerWith>[0],
    previous?: string,
  ) {
    const before = previous ? await installedBefore(previous) : undefined;
    const filesBefore = await filesUnder(installDir);
    const { events, recorded } = recordingEvents();
    const { controller, link } = controllerWith(setup);
    await controller.reconcile();
    const pathBefore = { ...(link as ReturnType<typeof fakeLink>).current() };

    const state = await events.run(
      "cli_command.install",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.install({ unit }),
    );

    expect(await filesUnder(installDir)).toEqual(filesBefore);
    // The user Path is as it was, value and kind.
    expect((link as ReturnType<typeof fakeLink>).current()).toEqual(pathBefore);
    // No record half written.
    expect(await readdir(path.dirname(recordFile)).catch(() => [])).toEqual(
      before ? ["cli-command.json"] : [],
    );
    if (before) {
      expect(JSON.parse(await readFile(recordFile, "utf8"))).toMatchObject(
        before!,
      );
      expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
        `binary ${previous}`,
      );
      // No staging folder, no old copy left.
      expect(await readdir(installDir)).toEqual(["ajour.exe", "share"]);
    } else {
      expect(await filesUnder(installDir)).toEqual([]);
      expect(existsSync(recordFile)).toBe(false);
    }
    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.install",
    )!;
    return { state, event, link: link as ReturnType<typeof fakeLink> };
  }

  it.each([
    [
      "a release without this platform's asset",
      { github: fakeGithub({ asset: { name: "ajour-other.zip" } }) },
      `The ${TAG} release has no ajour for Windows x64 yet. Try again in a few minutes.`,
      "missing_asset",
    ],
    [
      "a missing release",
      { github: fakeGithub({ release: null }) },
      `Ajour couldn't find its release, ${TAG}, on GitHub.`,
      "missing_release",
    ],
    [
      "an asset without a digest",
      { github: fakeGithub({ asset: { digest: null } }) },
      "GitHub published no checksum for the ajour download, so Ajour didn't install it.",
      "missing_digest",
    ],
    [
      "a download that doesn't match its digest",
      { github: fakeGithub({ asset: { digest: `sha256:${"0".repeat(64)}` } }) },
      "The ajour download doesn't match its published checksum, so Ajour didn't install it.",
      "digest_mismatch",
    ],
    [
      "an asset over 120 MB",
      { github: fakeGithub({ asset: { size: 120 * 1024 * 1024 + 1 } }) },
      "The ajour download is larger than 120 MB, so Ajour didn't download it.",
      "too_large",
    ],
    [
      "a download longer than its asset",
      { github: fakeGithub({ download: { extraBytes: 10 } }) },
      "The ajour download is larger than GitHub said, so Ajour stopped it.",
      "too_large",
    ],
    [
      "a redirect off HTTPS",
      {
        github: fakeGithub({
          download: {
            redirect: "http://release-assets.githubusercontent.com/x",
          },
        }),
      },
      "The ajour download was redirected away from HTTPS, so Ajour stopped it.",
      "redirect_off_https",
    ],
    [
      "a download URL outside Ajour's releases",
      {
        github: fakeGithub({
          asset: {
            browser_download_url: `https://github.com/someone/else/releases/download/${TAG}/${ASSET}`,
          },
        }),
      },
      "The ajour download isn't on Ajour's release page, so Ajour didn't download it.",
      "url_not_allowed",
    ],
    [
      "an archive entry that escapes its folder",
      { exec: fakeExec({ listing: ["./ajour.exe", "../evil.exe"] }) },
      "The ajour archive has a file that would land outside its folder, so Ajour didn't install it.",
      "escaping_entry",
    ],
    [
      "an archive entry with an absolute path",
      { exec: fakeExec({ listing: ["./ajour.exe", "C:/Windows/evil.exe"] }) },
      "The ajour archive has a file that would land outside its folder, so Ajour didn't install it.",
      "escaping_entry",
    ],
    [
      "an archive without ajour.exe",
      {
        github: fakeGithub({ archive: { "./": null, "./readme.txt": "hi" } }),
      },
      "The ajour archive has no ajour.exe, so Ajour didn't install it.",
      "invalid_archive",
    ],
    [
      "a binary that prints another version",
      {
        exec: fakeExec({
          versionOutput: () => "ajour 0.0.1-nightly.20261101.280\n",
        }),
      },
      `The downloaded ajour says "ajour 0.0.1-nightly.20261101.280", not "ajour ${VERSION}", so Ajour didn't install it.`,
      "wrong_version",
    ],
    [
      "a binary that doesn't run",
      {
        exec: fakeExec({
          versionOutput: () => {
            throw Object.assign(new Error("spawn failed"), { killed: true });
          },
        }),
      },
      "The downloaded ajour didn't print its version within 10 seconds, so Ajour didn't install it.",
      "wrong_version",
    ],
  ])(
    "refuses %s, with its own sentence",
    async (_name, setup, sentence, reason) => {
      const { state, event, link } = await refused(setup);

      expect(state).toEqual({
        status: "error",
        progress: null,
        error: sentence,
      });
      expect(link.writes).toEqual([]);
      expect(event.outcome).toBe("refused");
      expect(event.outcome_reason).toBe(reason);
    },
  );

  it("keeps the installed version when a new one is refused", async () => {
    const { state } = await refused(
      { github: fakeGithub({ asset: { digest: `sha256:${"0".repeat(64)}` } }) },
      "0.0.1-nightly.20261101.280",
    );

    expect(state).toMatchObject({
      status: "error",
      version: "0.0.1-nightly.20261101.280",
      location: installDir,
    });
  });

  it("keeps the commit on PATH failure and Retry reconciles without downloading again", async () => {
    let fail = true;
    const base = fakeLink();
    const link = {
      link: {
        ...base.link,
        add: async (folder: string) => {
          if (fail) throw new Error("PATH unavailable");
          return base.link.add(folder);
        },
      },
    };
    const { controller, github } = controllerWith({ link });
    expect((await controller.install()).error).toBe("PATH unavailable");
    expect(JSON.parse(await readFile(recordFile, "utf8")).version).toBe(
      VERSION,
    );
    const downloads = github.requests.length;
    fail = false;
    expect((await controller.install()).status).toBe("installed");
    expect(github.requests).toHaveLength(downloads);
    expect(base.current().value).toContain(installDir);
  });

  it("keeps the install when broadcasting the successful PATH write fails", async () => {
    const { controller } = controllerWith({
      link: fakeLink({ failBroadcast: true }),
    });
    expect((await controller.install()).status).toBe("installed");
  });

  it("takes the folder off the Path when the record can't be written", async () => {
    const files = fsWith({
      writeFile: (async (file: string, ...rest: unknown[]) => {
        if (String(file).startsWith(recordFile)) {
          throw Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          });
        }
        return (fs.writeFile as (...a: unknown[]) => Promise<void>)(
          file,
          ...rest,
        );
      }) as never,
    });

    const { state } = await refused({ files });

    expect(state.status).toBe("error");
  });

  it("takes the folder off the Path, and the half-written record away, when the record can't be renamed", async () => {
    const files = fsWith({
      rename: (async (from: string, to: string) => {
        if (to === recordFile)
          throw new Error("EPERM: operation not permitted");
        return fs.rename(from, to);
      }) as never,
    });

    const { state } = await refused({ files }, "0.0.1-nightly.20261101.280");

    expect(state).toMatchObject({
      status: "error",
      version: "0.0.1-nightly.20261101.280",
    });
  });

  it("says GitHub couldn't be reached when the lookup fails", async () => {
    const github = fakeGithub();
    const { controller } = controllerWith({
      github: {
        ...github,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
    });

    expect((await controller.install()).error).toBe(
      "Ajour couldn't reach GitHub. Check your connection, then try again.",
    );
  });

  it("can install again after a refusal", async () => {
    const first = controllerWith({
      github: fakeGithub({ asset: { name: "ajour-other.zip" } }),
    });
    await first.controller.install();

    const { controller } = controllerWith();
    expect((await controller.install()).status).toBe("installed");
  });
});

describe("writing the download", () => {
  /** `fs` whose files take at most `most(length)` bytes per write. */
  function shortWrites(
    most: (length: number) => number,
    { report }: { report?: (written: number, asked: number) => number } = {},
  ) {
    return fsWith({
      open: (async (...args: unknown[]) => {
        const handle = await (
          fs.open as (...a: unknown[]) => Promise<fs.FileHandle>
        )(...args);
        if (args[1] !== "w") return handle;
        return Object.assign(Object.create(handle), {
          async write(
            buffer: Uint8Array,
            offset = 0,
            length = buffer.byteLength - offset,
          ) {
            const { bytesWritten } = await handle.write(
              buffer,
              offset,
              Math.min(length, most(length)),
            );
            return {
              bytesWritten: report
                ? report(bytesWritten, length)
                : bytesWritten,
              buffer,
            };
          },
          close: () => handle.close(),
        });
      }) as never,
    });
  }

  it("writes each chunk whole when the file takes part of it at a time", async () => {
    const { controller } = controllerWith({
      files: shortWrites((length) => Math.max(1, Math.floor(length / 2))),
    });

    expect((await controller.install()).status).toBe("installed");
    expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
      `binary ${VERSION}`,
    );
  });

  it("checks the digest of what is on disk, not of what it meant to write", async () => {
    // The file says it took every byte, but kept half of each chunk.
    const { controller } = controllerWith({
      files: shortWrites((length) => Math.max(1, Math.floor(length / 2)), {
        report: (_written, asked) => asked,
      }),
    });

    const state = await controller.install();

    expect(state.error).toBe(
      "The ajour download doesn't match its published checksum, so Ajour didn't install it.",
    );
    expect(await filesUnder(installDir)).toEqual([]);
  });
});

describe("an install cut short", () => {
  const PREVIOUS = "0.0.1-nightly.20261101.280";

  /** Clears the temp folder, for one more install from scratch. */
  async function freshRoot() {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  }

  /**
   * Cuts an install at step `n`, then starts Ajour again: its recovery
   * must leave either the new install, whole, or what was there before,
   * whole, on disk, in the record and on the Path. Returns false once the
   * install has fewer steps than `n`.
   */
  async function cutAndRecover(n: number, previous?: string) {
    await freshRoot();
    const before = previous ? await installedBefore(previous) : undefined;
    const cut = interruption((step) => step.index === n);
    const link = fakeLink({
      initial: previous
        ? { value: `C:\\Tools;${installDir}`, kind: "String" }
        : { value: "C:\\Tools", kind: "String" },
      gate: cut.gate,
    });
    const { controller } = controllerWith({ files: cut.fs, link });
    const ended = await Promise.race([
      controller.install().then(() => "finished" as const),
      cut.cutReached.then(() => "cut" as const),
    ]);
    if (ended === "finished") return false;

    const saved = path.join(root, "snapshot");
    for (const folder of ["Local", "userData"]) {
      if (existsSync(path.join(root, folder)))
        await fs.cp(path.join(root, folder), path.join(saved, folder), {
          recursive: true,
        });
    }
    for (let recoveryStep = 1; ; recoveryStep += 1) {
      const recoveryCut = interruption((step) => step.index === recoveryStep);
      const recoveryLink = fakeLink({
        initial: link.current(),
        gate: recoveryCut.gate,
      });
      const recovering = controllerWith({
        files: recoveryCut.fs,
        link: recoveryLink,
      }).controller;
      const recoveryEnded = await Promise.race([
        recovering.reconcile().then(() => "finished"),
        recoveryCut.cutReached.then(() => "cut"),
      ]);
      // A further launch must finish even after recovery itself was interrupted.
      const next = controllerWith({
        link: { link: recoveryLink.nextLaunch() },
      });
      await next.controller.reconcile();
      const state = await next.controller.state();
      const where = `cut at step ${n}${previous ? ", over an earlier install" : ""}`;

      expect(
        await readdir(path.dirname(recordFile)).catch(() => []),
        where,
      ).toEqual(state.status === "installed" ? ["cli-command.json"] : []);
      if (state.status === "installed" && state.version === VERSION) {
        expect(await filesUnder(installDir), where).toEqual([
          "ajour.exe",
          "share/completions/ajour.bash",
          "share/man/man1/ajour.1",
        ]);
        expect(
          await readFile(path.join(installDir, "ajour.exe"), "utf8"),
          where,
        ).toBe(`binary ${VERSION}`);
        expect(recoveryLink.current().value, where).toContain(installDir);
      } else if (before) {
        expect(state, where).toMatchObject({
          status: "installed",
          version: previous,
        });
        expect(JSON.parse(await readFile(recordFile, "utf8")), where).toEqual(
          before,
        );
        expect(await readdir(installDir), where).toEqual([
          "ajour.exe",
          "share",
        ]);
        expect(
          await readFile(path.join(installDir, "ajour.exe"), "utf8"),
          where,
        ).toBe(`binary ${previous}`);
        expect(
          await readFile(
            path.join(installDir, "share", "man", "man1", "ajour.1"),
            "utf8",
          ),
          where,
        ).toBe("old manual");
        expect(recoveryLink.current(), where).toEqual(link.initial);
      } else {
        expect(state.status, where).toBe("not-installed");
        expect(await filesUnder(path.join(root, "Local")), where).toEqual([]);
        expect(recoveryLink.current(), where).toEqual(link.initial);
      }

      if (recoveryEnded === "finished") break;
      for (const folder of ["Local", "userData"]) {
        await rm(path.join(root, folder), { recursive: true, force: true });
        if (existsSync(path.join(saved, folder)))
          await fs.cp(path.join(saved, folder), path.join(root, folder), {
            recursive: true,
          });
      }
    }
    return true;
  }

  it("recovers a first install cut between any two steps", async () => {
    let n = 1;
    while (await cutAndRecover(n)) n += 1;
    // The download, the swap, the Path and the record: many steps.
    expect(n).toBeGreaterThan(10);
  }, 60_000);

  it("recovers an install over an earlier one cut between any two steps", async () => {
    let n = 1;
    while (await cutAndRecover(n, PREVIOUS)) n += 1;
    expect(n).toBeGreaterThan(10);
  }, 60_000);

  it("keeps the binary an interrupted swap set aside when the next install fails", async () => {
    const before = await installedBefore(PREVIOUS);
    // Cut right after ajour.exe moved aside: no ajour.exe is in place.
    let setAside = false;
    const cut = interruption((step) => {
      if (setAside) return true;
      if (
        step.name === "rename" &&
        String(step.args[0]) === path.join(installDir, "ajour.exe")
      ) {
        setAside = true;
      }
      return false;
    });
    const link = fakeLink({ gate: cut.gate });
    void controllerWith({ files: cut.fs, link }).controller.install();
    await cut.cutReached;
    expect(existsSync(path.join(installDir, "ajour.exe"))).toBe(false);

    // The next launch can't reach GitHub.
    const offline = fakeGithub();
    const { controller } = controllerWith({
      github: {
        ...offline,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
      link: { link: link.nextLaunch() },
    });
    const state = await controller.install();

    expect(state).toMatchObject({ status: "error", version: PREVIOUS });
    expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
      `binary ${PREVIOUS}`,
    );
    expect(JSON.parse(await readFile(recordFile, "utf8"))).toMatchObject(
      before!,
    );
    expect(await readdir(installDir)).toEqual(["ajour.exe", "share"]);
  });
});

describe("quitting during an install", () => {
  it("waits for a swap under way to finish", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let atPath!: () => void;
    const reachedPath = new Promise<void>((resolve) => {
      atPath = resolve;
    });
    const link = fakeLink({
      gate: async (_name, _args, run) => {
        atPath();
        await released;
        return await run();
      },
    });
    const { controller } = controllerWith({ link });
    const installing = controller.install();
    await reachedPath;

    let stopped = false;
    const stopping = controller.stop(5_000).then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect((await installing).status).toBe("installed");
    expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
      `binary ${VERSION}`,
    );
  });

  it("stops a download and leaves what was installed before", async () => {
    const before = await installedBefore("0.0.1-nightly.20261101.280");
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller, link } = controllerWith({
      github: fakeGithub({ download: { hold } }),
    });
    const seen: CliState[] = [];
    controller.onChange((state) => seen.push(state));
    const installing = controller.install();
    while (!seen.some((state) => (state.progress ?? 0) > 0)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await controller.stop(5_000);
    release();

    expect((await installing).status).toBe("error");
    expect(JSON.parse(await readFile(recordFile, "utf8"))).toMatchObject(
      before!,
    );
    expect(await readdir(installDir)).toEqual(["ajour.exe", "share"]);
    expect(link.current().value).toContain(installDir);
  });

  it("starts no install once Ajour quits", async () => {
    const { controller, github } = controllerWith();

    await controller.stop();
    const state = await controller.install();

    expect(state.status).toBe("not-installed");
    expect(github.requests).toEqual([]);
  });

  it("waits no longer than it is given", async () => {
    const link = fakeLink({ gate: () => new Promise<never>(() => {}) });
    const { controller } = controllerWith({ link });
    void controller.install();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const started = Date.now();
    await controller.stop(30);

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("where it doesn't install", () => {
  it("is unsupported in a development build, which has no release", async () => {
    const { controller, github } = controllerWith({ development: true });

    expect(await controller.state()).toEqual({
      status: "unsupported",
      reason: "development_build",
      progress: null,
      error: null,
    });
    expect((await controller.install()).status).toBe("unsupported");
    expect(github.requests).toEqual([]);
  });

  it("is unsupported for a version that was never released", async () => {
    const { controller, github } = controllerWith({
      appVersion: "0.1.0-local",
    });

    expect((await controller.install()).reason).toBe("development_build");
    expect(github.requests).toEqual([]);
  });

  it("is unsupported on Linux", async () => {
    const { controller } = controllerWith({
      platform: "linux",
      arch: "arm64",
    });

    expect(await controller.state()).toMatchObject({
      status: "unsupported",
      reason: "unsupported_platform",
    });
  });

  it("installs from a local release origin in a development build that names one", async () => {
    const origin = "http://127.0.0.1:4567";
    const github = fakeGithub({
      asset: {
        browser_download_url: `${origin}/les-cabochons/ajour/releases/download/${TAG}/${ASSET}`,
      },
      download: { redirect: `${origin}/assets/${ASSET}` },
    });
    const { controller } = controllerWith({
      github,
      development: true,
      releaseOrigin: origin,
    });

    expect((await controller.install()).status).toBe("installed");
    expect(github.requests[0]).toBe(
      `${origin}/repos/les-cabochons/ajour/releases/tags/${TAG}`,
    );
  });

  it("ignores a release origin in a packaged build", async () => {
    const { controller, github } = controllerWith({
      releaseOrigin: "http://127.0.0.1:4567",
    });

    await controller.install();

    expect(github.requests).toEqual([API, DOWNLOAD, ASSET_HOST]);
  });
});

describe("reconciliation failures", () => {
  it("blocks install and retries the same controller after the filesystem is available", async () => {
    let blocked = true;
    const files = fsWith({
      readdir: (async (...args: Parameters<typeof fs.readdir>) => {
        if (blocked) throw new Error("disk unavailable");
        return fs.readdir(...args);
      }) as never,
    });
    const { controller, github } = controllerWith({ files });
    expect((await controller.reconcile()).error).toContain("disk unavailable");
    expect((await controller.install()).status).toBe("error");
    expect(github.requests).toEqual([]);
    blocked = false;
    expect((await controller.install()).status).toBe("installed");
  });
});

describe("reconciliation across later installs", () => {
  it("skips a locked old executable, keeps a later commit, and cleans it when unlocked", async () => {
    await installedBefore("0.0.1-nightly.20261101.280");
    let locked = true;
    const files = fsWith({
      rm: (async (file: string, options: Parameters<typeof fs.rm>[1]) => {
        if (locked && String(file).includes("ajour.exe.old-"))
          throw Object.assign(new Error("locked"), { code: "EPERM" });
        return fs.rm(file, options);
      }) as never,
    });
    const { controller } = controllerWith({ files });
    expect((await controller.install()).status).toBe("installed");
    expect(
      (await readdir(installDir)).some((name) =>
        name.startsWith("ajour.exe.old-"),
      ),
    ).toBe(true);
    expect((await controller.install()).status).toBe("installed");
    const committed = await readFile(recordFile, "utf8");
    expect((await controller.reconcile()).version).toBe(VERSION);
    expect(await readFile(recordFile, "utf8")).toBe(committed);
    locked = false;
    expect((await controller.reconcile()).status).toBe("installed");
    expect(await readdir(installDir)).toEqual(["ajour.exe", "share"]);
  });
  it("removes only our PATH entry when an uncommitted install is discarded", async () => {
    const link = fakeLink({
      initial: {
        value: `C:\\Tools;${installDir};C:\\AddedLater;`,
        kind: "String",
      },
    });
    await mkdir(installDir, { recursive: true });
    await writeFile(path.join(installDir, "ajour.exe"), "uncommitted");
    const { controller } = controllerWith({ link });
    expect((await controller.reconcile()).status).toBe("not-installed");
    expect(link.current()).toEqual({
      value: "C:\\Tools;C:\\AddedLater;",
      kind: "String",
    });
  });
});

describe("ownership without a commit", () => {
  it.each(["ajour.exe", "share/manual"])(
    "preserves foreign %s at launch and refuses Install",
    async (name) => {
      const file = path.join(installDir, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "personal copy");
      const { controller, github } = controllerWith();
      expect((await controller.reconcile()).status).toBe("not-installed");
      expect(await readFile(file, "utf8")).toBe("personal copy");
      expect((await controller.install()).error).toBe(
        `There's already an ajour in ${installDir} that Ajour didn't install. Remove it, then install again.`,
      );
      expect(await readFile(file, "utf8")).toBe("personal copy");
      expect(github.requests).toEqual([]);
    },
  );
});

describe("generated cleanup names", () => {
  it("preserves personal backups beside a valid installation", async () => {
    await controllerWith().controller.install();
    const names = [
      "ajour.exe.old-personal-backup",
      "share.old-custom",
      ".staging-personal",
      ".pending-personal.json",
      ".pending-personal.json.tmp",
    ];
    for (const name of names) {
      await mkdir(path.join(installDir, name));
      await writeFile(path.join(installDir, name, "saved"), "personal");
    }
    expect((await controllerWith().controller.reconcile()).status).toBe(
      "installed",
    );
    for (const name of names)
      expect(await readFile(path.join(installDir, name, "saved"), "utf8")).toBe(
        "personal",
      );
  });
});

describe("installing with a literal REG_SZ Path", () => {
  it("adds a resolving entry even when REG_SZ contains the folder as a variable", async () => {
    const local = path.dirname(path.dirname(installDir));
    const initial = { value: "%LOCALAPPDATA%\\Ajour\\bin", kind: "String" };
    const link = fakeLink({ initial, env: { LOCALAPPDATA: local } });
    expect((await controllerWith({ link }).controller.install()).status).toBe(
      "installed",
    );
    expect(link.current()).toEqual({
      value: `${initial.value};${installDir}`,
      kind: "String",
    });
  });
});

describe("concurrent registry type changes", () => {
  it("keeps a type-only edit made while Install writes PATH", async () => {
    let changed = false;
    const link = fakeLink({
      initial: { value: "C:\\Tools", kind: "ExpandString" },
      gate: async (name, _args, run) => {
        if (name === "registry.write" && !changed) {
          changed = true;
          link.current().kind = "String";
        }
        return run();
      },
    });
    expect((await controllerWith({ link }).controller.install()).status).toBe(
      "installed",
    );
    expect(link.current()).toEqual({
      value: `C:\\Tools;${installDir}`,
      kind: "String",
    });
  });
});

describe("Install and reconcile interleaving", () => {
  it.each(["install", "reconcile"])(
    "serializes when %s starts first",
    async (first) => {
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached!: () => void;
      const atGate = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let blocked = false;
      const link = fakeLink({
        initial: { value: `C:\\Tools;${installDir}`, kind: "String" },
        gate: async (_name, _args, run) => {
          if (first === "reconcile" && !blocked) {
            blocked = true;
            reached();
            await hold;
          }
          return run();
        },
      });
      const exec = fakeExec({
        versionOutput: async () => {
          if (first === "install") {
            reached();
            await hold;
          }
          return `ajour ${VERSION}`;
        },
      });
      const { controller } = controllerWith({ link, exec });
      const firstCall =
        first === "install" ? controller.install() : controller.reconcile();
      await atGate;
      const secondCall =
        first === "install" ? controller.reconcile() : controller.install();
      release();
      await Promise.all([firstCall, secondCall]);
      expect((await controller.state()).status).toBe("installed");
      expect((await controller.reconcile()).status).toBe("installed");
      expect(link.current()).toEqual({
        value: `C:\\Tools;${installDir}`,
        kind: "String",
      });
      expect(await filesUnder(installDir)).toEqual([
        "ajour.exe",
        "share/completions/ajour.bash",
        "share/man/man1/ajour.1",
      ]);
    },
  );
});

describe("ownership evidence after an interrupted swap", () => {
  it("preserves a share tree modified since its pending marker was written", async () => {
    const cut = interruption(
      (step) => step.name === "rename" && step.args[1] === recordFile,
    );
    void controllerWith({ files: cut.fs }).controller.install();
    await cut.cutReached;
    await writeFile(path.join(installDir, "share", "personal"), "keep");
    const { controller } = controllerWith();
    expect((await controller.reconcile()).status).toBe("not-installed");
    expect(
      await readFile(path.join(installDir, "share", "personal"), "utf8"),
    ).toBe("keep");
    expect(existsSync(path.join(installDir, "ajour.exe"))).toBe(false);
    expect((await controller.install()).error).toContain(
      "Ajour didn't install",
    );
    expect((await readdir(installDir)).sort()).toEqual(["share"]);
  });
});

describe("macOS signature verification", () => {
  function mac(
    signatureFails = false,
    overrides: Parameters<typeof controllerWith>[0] = {},
  ) {
    const version = overrides?.appVersion ?? VERSION;
    const asset = `ajour-${version}-macos-${overrides?.arch ?? "x64"}.tar.gz`;
    const origin =
      overrides?.development && overrides.releaseOrigin
        ? overrides.releaseOrigin
        : "https://github.com";
    const archive = goodArchive(version);
    archive["./ajour"] = archive["./ajour.exe"]!;
    delete archive["./ajour.exe"];
    const github = fakeGithub({
      archive,
      asset: {
        name: asset,
        browser_download_url: `${origin}/les-cabochons/ajour/releases/download/v${version}/${asset}`,
      },
    });
    const base = fakeExec();
    const exec = {
      calls: base.calls,
      exec: async (file: string, args: string[]) => {
        if (file === "/usr/bin/codesign") {
          base.calls.push({ file, args });
          if (signatureFails) throw new Error("wrong team");
          return { stdout: "" };
        }
        return base.exec(file, args);
      },
    };
    return controllerWith({ platform: "darwin", github, exec, ...overrides });
  }
  it("verifies the team before executing the binary and installs the macOS archive", async () => {
    const { controller, exec } = mac();
    expect(await controller.install()).toMatchObject({
      status: "installed",
      location: "/usr/local/bin/ajour",
    });
    const signature = exec.calls.findIndex(
      (call) => call.file === "/usr/bin/codesign",
    );
    expect(signature).toBeGreaterThan(-1);
    expect(exec.calls[signature]!.args).toContain(
      'anchor apple generic and certificate leaf[subject.OU] = "DDX8GJH69G"',
    );
    expect(signature).toBeLessThan(
      exec.calls.findIndex((call) => call.args[0] === "-V"),
    );
  });
  it.each(["x64", "arm64"])("installs the archive for %s", async (arch) => {
    expect((await mac(false, { arch }).controller.install()).status).toBe(
      "installed",
    );
  });
  it.each([false, true])(
    "relaxes the team requirement only for the unpackaged local check, development=%s",
    async (development) => {
      const { controller, exec } = mac(false, {
        development,
        releaseOrigin: "http://127.0.0.1:1234",
        allowAdHocSignature: true,
      });
      expect((await controller.install()).status).toBe("installed");
      const call = exec.calls.find(
        (call) => call.file === "/usr/bin/codesign",
      )!;
      expect(call.args.includes("-R")).toBe(!development);
      expect(call.args.slice(0, 2)).toEqual(["--verify", "--strict"]);
    },
  );
  it("refuses a failed signature without executing or installing it", async () => {
    const { controller, exec } = mac(true);
    expect(await controller.install()).toMatchObject({
      status: "error",
      error: "The download isn't signed by Ajour. Nothing was installed.",
    });
    expect(exec.calls.some((call) => call.args[0] === "-V")).toBe(false);
    expect(await filesUnder(installDir)).toEqual([]);
    expect(existsSync(recordFile)).toBe(false);
  });
  it("keeps the previous command when a replacement signature fails", async () => {
    const previous = "0.0.1-nightly.20261101.280";
    expect(
      (await mac(false, { appVersion: previous }).controller.install()).status,
    ).toBe("installed");
    const record = await readFile(recordFile, "utf8");
    const state = await mac(true).controller.install();
    expect(state).toMatchObject({ status: "error", version: previous });
    expect(await readFile(recordFile, "utf8")).toBe(record);
    expect(await readFile(path.join(installDir, "ajour"), "utf8")).toBe(
      `binary ${previous}`,
    );
  });
  it("cancels the prompt without committing or leaving files", async () => {
    const link = {
      add: async () => {
        throw new Error(
          "Ajour needs your password to link /usr/local/bin/ajour. Nothing was installed.",
        );
      },
      remove: async () => {},
    };
    const { controller } = mac(false, { link: { link } });
    expect((await controller.install()).error).toContain(
      "Nothing was installed.",
    );
    expect(existsSync(recordFile)).toBe(false);
    expect(await filesUnder(installDir)).toEqual([]);
  });
  it("surfaces a missing link on launch and permits a prompt only on Retry", async () => {
    expect((await mac().controller.install()).status).toBe("installed");
    const prompts: boolean[] = [];
    const link = {
      add: async (_folder: string, options?: { interactive: boolean }) => {
        prompts.push(options?.interactive ?? false);
        if (!options?.interactive) throw new Error("Press Retry in Settings.");
        return { added: true };
      },
      remove: async () => {},
    };
    const { controller, github } = mac(false, { link: { link } });
    expect((await controller.reconcile()).status).toBe("error");
    expect(prompts).toEqual([false]);
    expect((await controller.install()).status).toBe("installed");
    expect(prompts).toEqual([false, true]);
    expect(github.requests).toEqual([]);
  });
  it("keeps old files when a foreign command prevents confirming absence", async () => {
    const old = "ajour.old-00000000-0000-0000-0000-000000000001";
    await mkdir(installDir, { recursive: true });
    await writeFile(path.join(installDir, old), "old command");
    const f = macosLinkFixture({ target: "/opt/homebrew/bin/ajour" });
    const adapter = f.link();
    const { controller } = mac(false, {
      link: {
        link: {
          add: () => adapter.add("/Users/alex/Ajour/bin"),
          remove: () => adapter.remove("/Users/alex/Ajour/bin"),
        },
      },
    });
    expect((await controller.reconcile()).status).toBe("error");
    expect(await readFile(path.join(installDir, old), "utf8")).toBe(
      "old command",
    );
    expect(f.current()).toBe("/opt/homebrew/bin/ajour");
  });
  it.each([true, false])(
    "keeps both old binaries when removal skips an old-A to old-B race, writable=%s",
    async (writable) => {
      const oldA = "ajour.old-00000000-0000-0000-0000-000000000001";
      const oldB = "ajour.old-00000000-0000-0000-0000-000000000002";
      await mkdir(installDir, { recursive: true });
      await writeFile(path.join(installDir, oldA), "old A");
      await writeFile(path.join(installDir, oldB), "old B");
      const folder = "/Users/alex/Ajour/bin";
      const f = macosLinkFixture({
        target: `${folder}/${oldA}`,
        writable,
        beforeExec: () => f.replace(`${folder}/${oldB}`),
      });
      const adapter = f.link();
      const { controller } = mac(false, {
        link: {
          link: {
            add: () => adapter.add(folder),
            remove: () => adapter.remove(folder, { interactive: true }),
          },
        },
      });
      const state = await controller.reconcile();
      expect(state.status).toBe("error");
      expect(state.error).toBe(
        "The ajour link changed during reconciliation. Press Retry in Settings.",
      );
      expect((await controller.state()).status).toBe("error");
      expect(f.current()).toBe(`${folder}/${oldB}`);
      expect(await readFile(path.join(installDir, oldA), "utf8")).toBe("old A");
      expect(await readFile(path.join(installDir, oldB), "utf8")).toBe("old B");
    },
  );
  it.each([true, false])(
    "repairs a stale owned link before cleanup, writable=%s",
    async (writable) => {
      expect((await mac().controller.install()).status).toBe("installed");
      const old = "ajour.old-00000000-0000-0000-0000-000000000001";
      await writeFile(path.join(installDir, old), "previous command");
      // The external command filesystem is virtual, including its install folder.
      const folder = "/Users/alex/Ajour/bin";
      const f = macosLinkFixture({ target: `${folder}/${old}`, writable });
      const adapter = f.link();
      const link = {
        add: (_folder: string, options?: unknown) =>
          adapter.add(folder, options),
        remove: () => adapter.remove(folder),
      };
      const cleanupTargets: Array<string | null> = [];
      const files = fsWith({
        rm: async (...args: Parameters<typeof fs.rm>) => {
          if (String(args[0]) === path.join(installDir, old))
            cleanupTargets.push(f.current());
          return fs.rm(...args);
        },
      });
      const { controller, github } = mac(false, { link: { link }, files });
      const state = await controller.reconcile();
      if (writable) {
        expect(state.status).toBe("installed");
        expect(f.current()).toBe(`${folder}/ajour`);
        expect(existsSync(path.join(installDir, old))).toBe(false);
      } else {
        expect(state.status).toBe("error");
        expect(state.error).toContain("Retry");
        expect(f.calls).toEqual([]);
        expect(existsSync(path.join(installDir, old))).toBe(true);
        expect((await controller.state()).status).toBe("error");
        expect((await controller.install()).status).toBe("installed");
        expect(f.current()).toBe(`${folder}/ajour`);
        expect(existsSync(path.join(installDir, old))).toBe(false);
        expect(github.requests).toEqual([]);
      }
      expect(cleanupTargets).toEqual([`${folder}/ajour`]);
    },
  );
  it.each([false, true])(
    "recovers a macOS install interrupted at every file and link step, previous=%s",
    async (previous) => {
      let steps = 0;
      for (let n = 1; ; n++) {
        await rm(installDir, { recursive: true, force: true });
        await rm(path.dirname(recordFile), { recursive: true, force: true });
        let linked = false;
        if (previous) {
          const before = mac(false, {
            appVersion: "0.0.1-nightly.20261101.280",
          });
          expect((await before.controller.install()).status).toBe("installed");
          linked = true;
        }
        const cut = interruption((step) => step.index === n);
        const baseLink = {
          add: async () => {
            const added = !linked;
            linked = true;
            return { added };
          },
          remove: async () => {
            linked = false;
          },
        };
        const link = {
          add: () => cut.gate("link.add", [], baseLink.add),
          remove: () => cut.gate("link.remove", [], baseLink.remove),
        };
        const installing = mac(false, {
          files: cut.fs,
          link: { link },
        }).controller.install();
        const ended = await Promise.race([
          installing.then(() => "finished"),
          cut.cutReached.then(() => "cut"),
        ]);
        if (ended === "finished") break;
        steps++;
        const next = mac(false, { link: { link: baseLink } }).controller;
        const state = await next.reconcile();
        expect(["installed", "not-installed"], `step ${n}`).toContain(
          state.status,
        );
        expect(linked, `step ${n}`).toBe(state.status === "installed");
        expect(existsSync(recordFile)).toBe(linked);
        expect(
          (await readdir(installDir).catch(() => [])).some((name) =>
            name.startsWith("."),
          ),
        ).toBe(false);
        if (!linked) expect(await filesUnder(installDir)).toEqual([]);
      }
      expect(steps).toBeGreaterThan(10);
    },
    60_000,
  );
});
