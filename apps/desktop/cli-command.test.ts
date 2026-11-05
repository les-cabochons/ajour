import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  wsl?: {
    version?: string;
    /** The version the Linux build follows to, also after it failed. */
    pending?: string;
    distros: {
      name: string;
      wslVersion: 1 | 2;
      status: string;
      phase?: string;
      progress?: number | null;
      error?: string;
      added?: boolean;
      operation?: "add" | "remove" | "follow";
      reason?: string;
      hint?: string;
    }[];
  };
  /** After Remove: the WSL links it couldn't delete, as a sentence. */
  notice?: string;
  operation?: "remove";
  status:
    | "unsupported"
    | "not-installed"
    | "installing"
    | "installed"
    | "removing"
    | "error";
  version?: string;
  binaryPath?: string;
  location?: string;
  phase?: "downloading" | "checking" | "linking";
  progress: number | null;
  error: string | null;
  reason?: "development_build" | "unsupported_platform";
  newlyInstalled?: boolean;
  pending?: string;
};
type Controller = {
  state(): Promise<CliState>;
  addWsl(distro: string, options?: { unit?: unknown }): Promise<CliState>;
  removeWsl(distro: string, options?: { unit?: unknown }): Promise<CliState>;
  install(options?: { unit?: unknown }): Promise<CliState>;
  remove(options?: { unit?: unknown }): Promise<CliState>;
  followAppVersion(): Promise<CliState>;
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
    if (file.endsWith("wsl.exe")) throw new Error("WSL is not installed.");
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
  events,
  now = () => Date.parse("2026-11-04T10:00:00Z"),
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
  events?: unknown;
  now?: () => number;
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
    events,
    paths: { installDir, recordFile, tar: TAR },
    link: link.link,
    now,
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
    ["linux", "x64", `ajour-${VERSION}-linux-x64.tar.gz`],
    ["freebsd", "x64", null],
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
  it("follows with the macOS link unchanged and never prompts", async () => {
    await mac(false, { appVersion: "0.0.0" }).controller.install();
    const f = macosLinkFixture({
      target: "/Users/alex/Ajour/bin/ajour",
      writable: false,
    });
    const adapter = f.link();
    const { controller } = mac(false, {
      link: {
        link: {
          add: (_folder: string, options?: unknown) =>
            adapter.add("/Users/alex/Ajour/bin", options),
          remove: (_folder: string, options?: unknown) =>
            adapter.remove("/Users/alex/Ajour/bin", options),
        },
      },
    });
    expect(await controller.followAppVersion()).toMatchObject({
      status: "installed",
      version: VERSION,
    });
    expect(f.calls).toEqual([]);
  });
  it("surfaces a password-needing follow repair and permits it only on Retry", async () => {
    await mac(false, { appVersion: "0.0.0" }).controller.install();
    const prompts: boolean[] = [];
    const link = {
      add: async (_folder: string, options?: { interactive: boolean }) => {
        prompts.push(options?.interactive ?? false);
        if (!options?.interactive) throw new Error("Press Retry in Settings.");
        return { added: false };
      },
      remove: async () => ({ added: false }),
    };
    const { controller } = mac(false, { link: { link } });
    expect(await controller.followAppVersion()).toMatchObject({
      status: "error",
      version: "0.0.0",
      pending: VERSION,
    });
    expect(prompts.every((interactive) => !interactive)).toBe(true);
    // Once repaired interactively, noninteractive verification succeeds too.
    link.add = async (_folder, options) => {
      prompts.push(options?.interactive ?? false);
      return { added: false };
    };
    expect(await controller.install()).toMatchObject({
      status: "installed",
      version: VERSION,
    });
    expect(prompts).toContain(true);
  });
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
    // codesign reads -R as a file path unless the text starts with "=".
    const args = exec.calls[signature]!.args;
    expect(args[args.indexOf("-R") + 1]).toBe(
      '=anchor apple generic and certificate leaf[subject.OU] = "DDX8GJH69G"',
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
  // Settings shows WSL rows from main's state alone.
  it("has no WSL rows and never runs wsl.exe", async () => {
    const { controller, exec } = mac();
    await controller.install();

    expect((await controller.state()).wsl).toBeUndefined();
    expect(exec.calls.some((call) => call.file.endsWith("wsl.exe"))).toBe(
      false,
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
  it("keeps a pending install target until its privileged link is removed on Retry", async () => {
    await mkdir(installDir, { recursive: true });
    const bytes = Buffer.from("uncommitted command");
    await writeFile(path.join(installDir, "ajour"), bytes);
    const marker = ".pending-00000000-0000-0000-0000-000000000001.json";
    await writeFile(
      path.join(installDir, marker),
      JSON.stringify({ digests: { ajour: sha256(bytes) } }),
    );
    const folder = "/Users/alex/Ajour/bin";
    const f = macosLinkFixture({ target: `${folder}/ajour`, writable: false });
    const adapter = f.link();
    let removed = false;
    const files = fsWith({
      rm: async (...args: Parameters<typeof fs.rm>) => {
        if (String(args[0]) === path.join(installDir, "ajour"))
          expect(removed).toBe(true);
        return fs.rm(...args);
      },
    });
    const link = {
      add: (_folder: string, options?: unknown) => adapter.add(folder, options),
      remove: async (_folder: string, options?: unknown) => {
        const result = await adapter.remove(folder, options);
        removed = true;
        return result;
      },
    };
    const { controller } = mac(false, { files, link: { link } });
    expect(await controller.reconcile()).toMatchObject({
      status: "error",
      error: expect.stringContaining("Retry"),
    });
    expect(await readFile(path.join(installDir, "ajour"))).toEqual(bytes);
    expect(existsSync(path.join(installDir, marker))).toBe(true);
    expect(f.current()).toBe(`${folder}/ajour`);
    expect((await controller.install()).status).toBe("installed");
    expect(removed).toBe(true);
    expect(existsSync(path.join(installDir, marker))).toBe(false);
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

describe("following the app version", () => {
  it("replaces a newer installed CLI with the app's version", async () => {
    await installedBefore("0.0.1-nightly.20261105.295");
    const { controller } = controllerWith();
    expect(await controller.followAppVersion()).toMatchObject({
      status: "installed",
      version: VERSION,
    });
    expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
      `binary ${VERSION}`,
    );
  });

  it("updates a previous install without changing its Path", async () => {
    await installedBefore("0.0.0");
    const { controller, link } = controllerWith();
    await controller.reconcile();
    const before = link.current();
    const result = await controller.followAppVersion();
    expect(result).toMatchObject({ status: "installed", version: VERSION });
    expect(link.current()).toEqual(before);
    expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
      `binary ${VERSION}`,
    );
  });
});

it("records cli_command.follow and its refusal while keeping the old command usable", async () => {
  await installedBefore("0.0.0");
  const { events, recorded } = recordingEvents();
  const { controller } = controllerWith({
    events,
    github: fakeGithub({ asset: { digest: "sha256:" + "0".repeat(64) } }),
  });
  const failed = await controller.followAppVersion();
  expect(failed).toMatchObject({
    status: "error",
    version: "0.0.0",
    pending: VERSION,
  });
  expect(
    await fakeExec().exec(path.join(installDir, "ajour.exe"), ["-V"]),
  ).toEqual({ stdout: "ajour 0.0.0\n" });
  expect(recorded).toContainEqual(
    expect.objectContaining({
      name: "cli_command.follow",
      kind: "job",
      outcome: "refused",
      outcome_reason: "digest_mismatch",
    }),
  );
});

it("retries a missing asset after five minutes, then hourly, until the asset appears", async () => {
  await installedBefore("0.0.0");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const missing = fakeGithub({ release: { assets: [] } });
  const available = fakeGithub();
  let ready = false;
  let attempts = 0;
  const github = {
    ...missing,
    fetch: async (...args: Parameters<typeof missing.fetch>) => {
      if (args[0].includes("/tags/")) attempts++;
      return (ready ? available : missing).fetch(...args);
    },
  };
  const { controller } = controllerWith({ github });
  const states: CliState[] = [];
  let settled!: () => void;
  controller.onChange((state) => {
    states.push(state);
    if (state.status === "error" || state.status === "installed") settled();
  });
  const nextSettlement = () =>
    new Promise<void>((resolve) => {
      settled = resolve;
    });
  try {
    const initialFollow = nextSettlement();
    await controller.followAppVersion();
    await initialFollow;
    expect(attempts).toBe(1);
    expect(states.at(-1)).toMatchObject({ status: "error", pending: VERSION });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(attempts).toBe(1);
    const firstRetry = nextSettlement();
    await vi.advanceTimersByTimeAsync(1);
    await firstRetry;
    expect(attempts).toBe(2);
    expect(states.filter((state) => state.status === "error")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_599_999);
    expect(attempts).toBe(2);
    const hourlyRetry = nextSettlement();
    await vi.advanceTimersByTimeAsync(1);
    await hourlyRetry;
    expect(attempts).toBe(3);
    expect(states.filter((state) => state.status === "error")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(3_599_999);
    expect(attempts).toBe(3);
    ready = true;
    const successfulRetry = nextSettlement();
    await vi.advanceTimersByTimeAsync(1);
    await successfulRetry;
    expect(states.at(-1)).toMatchObject({
      status: "installed",
      version: VERSION,
    });
    expect(attempts).toBe(4);
    expect(missing.requests).toEqual([API, API, API]);
    expect(available.requests).toEqual([API, DOWNLOAD, ASSET_HOST]);
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(attempts).toBe(4);
  } finally {
    await controller.stop();
    vi.useRealTimers();
  }
});

it.each(["Install", "Retry"])(
  "joins an in-flight %s when a previously queued retry timer fires",
  async (action) => {
    await installedBefore("0.0.0");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const timers = vi.spyOn(globalThis, "setTimeout");
    const missing = fakeGithub({ release: { assets: [] } });
    const available = fakeGithub();
    let ready = false;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const atGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const exec = fakeExec({
      versionOutput: async () => {
        reached();
        await hold;
        return `ajour ${VERSION}`;
      },
    });
    const github = {
      ...missing,
      fetch: (...args: Parameters<typeof missing.fetch>) =>
        (ready ? available : missing).fetch(...args),
    };
    const { controller } = controllerWith({ github, exec });
    const states: CliState[] = [];
    controller.onChange((state) => states.push(state));
    try {
      await controller.followAppVersion();
      const callback = timers.mock.calls.find(
        (call) => call[1] === 300_000,
      )![0];
      expect(typeof callback).toBe("function");
      // Reconciliation clears the follow error, so Install takes its normal path.
      if (action === "Install") await controller.reconcile();
      ready = true;
      const installing = controller.install();
      await atGate;
      const requests = [...available.requests];
      const calls = exec.calls.length;
      const emissions = states.length;
      // Cancellation cannot retract a callback already queued by the event loop.
      (callback as () => void)();
      await vi.advanceTimersByTimeAsync(0);
      expect(available.requests).toEqual(requests);
      expect(exec.calls).toHaveLength(calls);
      expect(states).toHaveLength(emissions);
      release();
      expect(await installing).toMatchObject({
        status: "installed",
        version: VERSION,
      });
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(available.requests).toEqual([API, DOWNLOAD, ASSET_HOST]);
      expect(
        states.filter(
          (state) => state.status === "installed" && state.version === VERSION,
        ),
      ).toHaveLength(1);
    } finally {
      release();
      await controller.stop();
      timers.mockRestore();
      vi.useRealTimers();
    }
  },
);

it("defers a retry timer's install until in-flight reconciliation finishes", async () => {
  await installedBefore("0.0.0");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const missing = fakeGithub({ release: { assets: [] } });
  const available = fakeGithub();
  let ready = false;
  let blocked = false;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const atGate = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let diskPasses = 0;
  const files = fsWith({
    readdir: async (...args: Parameters<typeof fs.readdir>) => {
      if (args[0] === installDir && blocked) {
        diskPasses++;
        reached();
        await hold;
      }
      return fs.readdir(...args);
    },
  });
  const github = {
    ...missing,
    fetch: (...args: Parameters<typeof missing.fetch>) =>
      (ready ? available : missing).fetch(...args),
  };
  const { controller } = controllerWith({ github, files });
  const installed = new Promise<void>((resolve) => {
    controller.onChange((state) => {
      if (state.status === "installed" && state.version === VERSION) resolve();
    });
  });
  try {
    await controller.followAppVersion();
    blocked = true;
    const reconciling = controller.reconcile();
    await atGate;
    ready = true;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(diskPasses).toBe(1);
    expect(available.requests).toEqual([]);
    expect(missing.requests).toEqual([API]);
    blocked = false;
    release();
    await reconciling;
    await installed;
    expect(available.requests).toEqual([API, DOWNLOAD, ASSET_HOST]);
    expect(await controller.state()).toMatchObject({
      status: "installed",
      version: VERSION,
    });
  } finally {
    release();
    await controller.stop();
    vi.useRealTimers();
  }
});

it("does not retry other failures until another launch or an explicit Retry", async () => {
  await installedBefore("0.0.0");
  const github = fakeGithub({ download: { status: 503 } });
  const { controller } = controllerWith({ github });
  await controller.followAppVersion();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const requests = github.requests.length;
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(github.requests).toHaveLength(requests);
  } finally {
    await controller.stop();
    vi.useRealTimers();
  }
  const next = controllerWith().controller;
  expect(await next.followAppVersion()).toMatchObject({
    status: "installed",
    version: VERSION,
  });
});

it("clears a pending missing-asset retry on stop", async () => {
  await installedBefore("0.0.0");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { controller, github } = controllerWith({
    github: fakeGithub({ release: { assets: [] } }),
  });
  try {
    await controller.followAppVersion();
    await controller.stop();
    await vi.advanceTimersByTimeAsync(10 * 60 * 60_000);
    expect(github.requests).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("does nothing when not installed or in a development build", async () => {
  const fresh = controllerWith();
  await fresh.controller.followAppVersion();
  expect(fresh.github.requests).toEqual([]);
  expect(existsSync(installDir)).toBe(false);
  await installedBefore("0.0.0");
  const dev = controllerWith({ development: true });
  await dev.controller.followAppVersion();
  expect(dev.github.requests).toEqual([]);
});

it("sets aside a running Windows executable and cleans it on a later launch", async () => {
  await installedBefore("0.0.0");
  let locked = true;
  const files = fsWith({
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (locked && /ajour\.exe\.old-/.test(String(args[0])))
        throw Object.assign(new Error("running exe"), { code: "EPERM" });
      return fs.rm(...args);
    },
    rename: async (source: string, target: string) => {
      // Windows allows renaming a running executable, but not replacing it directly.
      if (
        locked &&
        target === path.join(installDir, "ajour.exe") &&
        existsSync(target)
      )
        throw Object.assign(new Error("running exe"), { code: "EPERM" });
      return fs.rename(source, target);
    },
  });
  expect(
    await controllerWith({ files }).controller.followAppVersion(),
  ).toMatchObject({ status: "installed", version: VERSION });
  expect(
    (await readdir(installDir)).some((name) =>
      name.startsWith("ajour.exe.old-"),
    ),
  ).toBe(true);
  locked = false;
  await controllerWith({ files }).controller.reconcile();
  expect(
    (await readdir(installDir)).some((name) =>
      name.startsWith("ajour.exe.old-"),
    ),
  ).toBe(false);
});

describe("Remove from Settings", () => {
  it("removes the committed command, record and exact Path entry, preserving user state", async () => {
    const link = fakeLink({
      initial: { value: "C:\\Tools;%TOOLS%", kind: "ExpandString" },
    });
    const { controller } = controllerWith({ link });
    await controller.install();
    await writeFile(path.join(root, "token"), "personal token");
    const { events, recorded } = recordingEvents();
    const unit = events.start("cli_command.remove", {
      kind: "command",
      trigger: "user",
    });
    const states: string[] = [];
    controller.onChange((state) => states.push(state.status));
    const removed = await controller.remove({ unit });
    unit.end();
    expect(removed.status).toBe("not-installed");
    expect(states).toContain("removing");
    expect(existsSync(installDir)).toBe(false);
    expect(existsSync(recordFile)).toBe(false);
    expect(link.current()).toEqual(link.initial);
    expect(await readFile(path.join(root, "token"), "utf8")).toBe(
      "personal token",
    );
    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "cli_command.remove",
          outcome: "ok",
          kind: "command",
        }),
      ]),
    );
  });
});

it("queues Remove after an in-flight Install and keeps later reconciliation serialized", async () => {
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const exec = fakeExec({
    versionOutput: async () => {
      reached();
      await hold;
      return `ajour ${VERSION}`;
    },
  });
  const { controller, link } = controllerWith({ exec });
  const install = controller.install();
  await gate;
  const remove = controller.remove();
  const reconcile = controller.reconcile();
  release();
  await Promise.all([install, remove, reconcile]);
  expect((await controller.state()).status).toBe("not-installed");
  expect(link.current()).toEqual(link.initial);
  expect(existsSync(installDir)).toBe(false);
});

it("keeps modified and unrelated files while removing owned command files", async () => {
  const { controller } = controllerWith();
  await controller.install();
  await writeFile(path.join(installDir, "personal.txt"), "keep");
  await writeFile(path.join(installDir, "share", "custom"), "keep too");
  await controller.remove();
  expect(await readFile(path.join(installDir, "personal.txt"), "utf8")).toBe(
    "keep",
  );
  expect(await readFile(path.join(installDir, "share", "custom"), "utf8")).toBe(
    "keep too",
  );
  expect(existsSync(path.join(installDir, "ajour.exe"))).toBe(false);
  expect(existsSync(recordFile)).toBe(false);
});

it("restores the commit when the real macOS adapter reports a cancelled removal prompt", async () => {
  const { controller: installer } = controllerWith();
  await installer.install();
  const before = await readFile(recordFile, "utf8");
  const folder = "/Users/alex/Ajour/bin";
  const f = macosLinkFixture({
    target: `${folder}/ajour`,
    writable: false,
    cancelled: true,
  });
  const adapter = f.link();
  const { controller } = controllerWith({
    link: {
      link: {
        add: async () => ({ added: false }),
        remove: () => adapter.remove(folder, { interactive: true }),
      },
    },
  });
  const { events, recorded } = recordingEvents();
  const unit = events.start("cli_command.remove", {
    kind: "command",
    trigger: "user",
  });
  const result = await controller.remove({ unit });
  unit.end();
  expect(result.error).toBe(
    "Ajour needs your password to remove /usr/local/bin/ajour. Nothing was removed.",
  );
  expect(await readFile(recordFile, "utf8")).toBe(before);
  expect(f.current()).toBe(`${folder}/ajour`);
  expect(existsSync(path.join(installDir, "ajour.exe"))).toBe(true);
  expect(recorded).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "cli_command.remove",
        outcome: "refused",
        outcome_reason: "admin_cancelled",
      }),
    ]),
  );
});

it("cancels a pending follow retry on Remove", async () => {
  await installedBefore("0.0.0");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const github = fakeGithub({ release: { assets: [] } });
  const { controller } = controllerWith({ github });
  try {
    await controller.followAppVersion();
    expect(github.requests).toEqual([API]);
    await controller.remove();
    await vi.advanceTimersByTimeAsync(3_900_000);
    expect(github.requests).toEqual([API]);
    expect((await controller.state()).status).toBe("not-installed");
    expect(existsSync(installDir)).toBe(false);
  } finally {
    await controller.stop();
    vi.useRealTimers();
  }
});

const LINUX_ASSET = `ajour-${VERSION}-linux-x64.tar.gz`;
const LINUX_DOWNLOAD = DOWNLOAD.replace(ASSET, LINUX_ASSET);
const linuxArchive = (version = VERSION): Archive => ({
  "./": null,
  "./ajour": `binary ${version}`,
  "./man/": null,
  "./man/man1/": null,
  "./man/man1/ajour.1": "manual",
  "./completions/": null,
  "./completions/ajour.bash": "complete -F _ajour ajour",
});
/** The release of `version` with its Linux build. */
const linuxRelease = (
  asset: Record<string, unknown> = {},
  version = VERSION,
) => {
  const name = `ajour-${version}-linux-x64.tar.gz`;
  return fakeGithub({
    archive: linuxArchive(version),
    asset: {
      name,
      browser_download_url: `https://github.com/les-cabochons/ajour/releases/download/v${version}/${name}`,
      ...asset,
    },
  });
};

/** What one fake distro holds: its home, its login PATH and `~/.local/bin`. */
type FakeDistro = {
  home: string;
  loginPath: string;
  /** Whether `~/.local/bin` exists. */
  bin: boolean;
  /** `~/.local/bin/ajour`: absent, a link to a target, or someone's file. */
  entry: { link: string } | { file: string } | null;
  /** A program whose run fails in this distro. */
  failing?: string;
  /** What the downloaded binary prints for `-V` here, instead of its version. */
  versionOutput?: string;
  /** How running the downloaded binary fails here, as WSL 1 fails one it can't load. */
  versionFailure?: { code?: number; killed?: boolean; message: string };
  /** The WSL version the distro runs on: 2 unless a test says 1. */
  version: 1 | 2;
  /** The STATE column, which WSL translates. */
  state: string;
};

const exited = (code: number, message = `exited with ${code}`) =>
  Object.assign(new Error(message), { code });

/**
 * `wsl.exe` over fake distros. `--list --verbose` answers in `encoding`, as
 * WSL answers in UTF-16LE unless `WSL_UTF8` is honoured: a header, then
 * NAME, STATE and VERSION, `*` before the default distro, and Docker
 * Desktop's distros too. `-d NAME --exec PROGRAM ARGS…` runs in a distro:
 * `wslpath -u` mounts the Windows path under /mnt/c, the mounted binary
 * prints the version its file holds, `sh -lc` prints the login HOME and
 * PATH, and `sh -c SCRIPT sh TARGET` links `~/.local/bin/ajour` as #604
 * describes: absent, it links and reports what it created; linked to
 * TARGET, it does nothing; anything else exits 17. With the folders it
 * created after TARGET, it removes that link again.
 */
function fakeWsl(
  names: Record<string, Partial<FakeDistro>>,
  { encoding = "utf16le" }: { encoding?: "utf16le" | "utf8" } = {},
) {
  const base = fakeExec();
  const distros = new Map<string, FakeDistro>(
    Object.entries(names).map(([name, distro]) => {
      const home = distro.home ?? "/home/ada";
      return [
        name,
        {
          home,
          loginPath: `${home}/.local/bin:/usr/local/bin:/usr/bin`,
          bin: false,
          entry: null,
          version: 2,
          state: "Stopped",
          ...distro,
        },
      ];
    }),
  );
  const mounted = new Map<string, string>();
  /** Every `--list` read, and every program run inside a distro. */
  const lists: string[][] = [];
  const entered: Array<{ distro: string; program: string; args: string[] }> =
    [];
  const exec = async (
    file: string,
    args: string[],
    options?: { timeout?: number; env?: Record<string, string | undefined> },
  ) => {
    if (!file.endsWith("wsl.exe")) return base.exec(file, args, options);
    if (args[0] === "--list") {
      expect(args).toEqual(["--list", "--verbose"]);
      expect(options?.env?.WSL_UTF8).toBe("1");
      lists.push(args);
      const row = (
        marker: string,
        name: string,
        state: string,
        version: 1 | 2,
      ) => `${marker} ${name.padEnd(22)} ${state.padEnd(15)} ${version}`;
      const listed = [
        "  NAME                   STATE           VERSION",
        ...[...distros].map(([name, distro], index) =>
          row(index === 0 ? "*" : " ", name, distro.state, distro.version),
        ),
        row(" ", "docker-desktop", "Running", 2),
        row(" ", "docker-desktop-data", "Running", 2),
      ];
      return {
        stdout: Buffer.from(`${listed.join("\r\n")}\r\n`, encoding),
      };
    }
    const [flag, name, execFlag, program, ...rest] = args;
    expect([flag, execFlag]).toEqual(["-d", "--exec"]);
    const distro = distros.get(name!);
    if (!distro) throw exited(1, `There is no distribution named ${name}.`);
    entered.push({ distro: name!, program: program!, args: rest });
    if (distro.failing === program) throw exited(1);
    if (program === "wslpath") {
      expect(rest[0]).toBe("-u");
      const mount = `/mnt/c/${rest[1]!
        .replace(/^[A-Za-z]:/, "")
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")}`;
      mounted.set(mount, rest[1]!);
      return { stdout: `${mount}\n` };
    }
    if (mounted.has(program!)) {
      expect(rest).toEqual(["-V"]);
      if (distro.versionFailure)
        throw Object.assign(new Error(distro.versionFailure.message), {
          ...distro.versionFailure,
        });
      if (distro.versionOutput) return { stdout: `${distro.versionOutput}\n` };
      const bytes = await readFile(mounted.get(program!)!, "utf8");
      return { stdout: `ajour ${bytes.replace("binary ", "")}\n` };
    }
    if (program === "sh" && rest[0] === "-lc") {
      // A login shell may print its own lines first.
      return { stdout: `Welcome!\n\n${distro.home}\n${distro.loginPath}\n` };
    }
    if (program === "sh" && rest[0] === "-c" && rest[2] === "sh") {
      const [target, madeBin] = rest.slice(3);
      if (madeBin === undefined) {
        if (distro.entry && "link" in distro.entry) {
          if (distro.entry.link === target) return { stdout: "" };
        }
        if (distro.entry) throw exited(17);
        const created = distro.bin ? 0 : 1;
        distro.bin = true;
        distro.entry = { link: target! };
        return { stdout: `created:${created}:0` };
      }
      if (
        distro.entry &&
        "link" in distro.entry &&
        distro.entry.link === target
      )
        distro.entry = null;
      if (madeBin === "1") distro.bin = false;
      return { stdout: "" };
    }
    throw new Error(
      `Unexpected program in ${name}: ${program} ${rest.join(" ")}`,
    );
  };
  return { exec, calls: base.calls, distros, lists, entered };
}

/** Everything an Add may change: the record, `bin\linux` and each distro. */
async function wslSnapshot(wsl: ReturnType<typeof fakeWsl>) {
  return {
    record: existsSync(recordFile) ? await readFile(recordFile, "utf8") : null,
    linux: await filesUnder(path.join(installDir, "linux")),
    distros: structuredClone([...wsl.distros]),
  };
}

const distroRow = (state: CliState, name: string) =>
  state.wsl?.distros.find((row) => row.name === name);

describe("the WSL distros", () => {
  it.each(["utf16le", "utf8"] as const)(
    "lists the distros from %s output, without Docker's, and enters none",
    async (encoding) => {
      await installedBefore(VERSION);
      const wsl = fakeWsl({ Ubuntu: {}, Debian: {} }, { encoding });
      const { controller } = controllerWith({ exec: wsl });

      const state = await controller.state();

      expect(state.wsl?.distros).toEqual([
        {
          name: "Ubuntu",
          wslVersion: 2,
          status: "not-added",
        },
        {
          name: "Debian",
          wslVersion: 2,
          status: "not-added",
        },
      ]);
      expect(wsl.entered).toEqual([]);
    },
  );

  it("lists a WSL 1 distro as unsupported, with its version, and enters none", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({
      // WSL translates STATE, sometimes into several words.
      "Ubuntu-24.04": { version: 1, state: "Wird ausgeführt" },
      Debian: {},
    });
    const { controller } = controllerWith({ exec: wsl });

    const state = await controller.state();

    expect(state.wsl?.distros).toEqual([
      {
        name: "Ubuntu-24.04",
        wslVersion: 1,
        status: "unsupported",
        reason:
          "WSL 1 isn't supported. Convert it with: wsl --set-version Ubuntu-24.04 2",
      },
      {
        name: "Debian",
        wslVersion: 2,
        status: "not-added",
      },
    ]);
    expect(wsl.entered).toEqual([]);
  });

  it("reads the list when the state is asked for, once per 30 seconds, never at launch", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    let time = Date.parse("2026-11-04T10:00:00Z");
    const { controller } = controllerWith({ exec: wsl, now: () => time });

    await controller.reconcile();
    await controller.followAppVersion();
    expect(wsl.lists).toEqual([]);

    await controller.state();
    time += 29_000;
    await controller.state();
    expect(wsl.lists).toHaveLength(1);
    time += 2_000;
    await controller.state();
    expect(wsl.lists).toHaveLength(2);
  });

  it("has no distro rows without the command, or without a usable distro", async () => {
    const wsl = fakeWsl({ Ubuntu: {} });
    expect(
      (await controllerWith({ exec: wsl }).controller.state()).wsl,
    ).toBeUndefined();
    expect(wsl.lists).toEqual([]);

    await installedBefore(VERSION);
    // fakeExec's wsl.exe fails, as on a Windows without WSL.
    expect((await controllerWith().controller.state()).wsl).toBeUndefined();
  });

  it("has no distro rows on Windows arm64, which no Linux build serves", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const { controller } = controllerWith({ exec: wsl, arch: "arm64" });

    expect((await controller.state()).wsl).toBeUndefined();
    expect(wsl.lists).toEqual([]);
  });

  it("shows the rows as soon as the command is installed", async () => {
    const wsl = fakeWsl({ Ubuntu: {} });
    const { controller } = controllerWith({ exec: wsl });

    const state = await controller.install();

    expect(state.status).toBe("installed");
    expect(distroRow(state, "Ubuntu")?.status).toBe("not-added");
  });
});

describe("adding the command to a WSL distro", () => {
  it("links ~/.local/bin/ajour to the verified Linux build in Ajour's folder", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const { controller, github } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();

    const state = await controller.addWsl("Ubuntu");

    expect(distroRow(state, "Ubuntu")).toEqual({
      name: "Ubuntu",
      wslVersion: 2,
      status: "added",
      hint: "Open a new Ubuntu terminal to use it.",
    });
    expect(github.requests).toEqual([API, LINUX_DOWNLOAD, ASSET_HOST]);
    expect(await filesUnder(path.join(installDir, "linux"))).toEqual([
      "ajour",
      "share/completions/ajour.bash",
      "share/man/man1/ajour.1",
    ]);
    const target = wsl.distros.get("Ubuntu")!.entry;
    expect(target).toEqual({
      link: expect.stringMatching(/^\/mnt\/c\/.*\/Ajour\/bin\/linux\/ajour$/),
    });
    const record = JSON.parse(await readFile(recordFile, "utf8"));
    expect(record.wsl).toEqual({
      version: VERSION,
      digests: { linux: expect.stringMatching(/^[0-9a-f]{64}$/) },
      distros: ["Ubuntu"],
    });
    // The values reached wsl.exe as arguments of their own.
    expect(wsl.entered.find((run) => run.program === "sh")?.args.at(-1)).toBe(
      (target as { link: string }).link,
    );
  });

  it("reuses the build for a second distro, and a second Add changes nothing", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {}, Debian: {} });
    const { controller, github } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();
    await controller.addWsl("Ubuntu");
    const phases: string[] = [];
    controller.onChange((state) => {
      const row = distroRow(state, "Debian");
      if (row?.status === "adding") phases.push(row.phase!);
    });

    expect(distroRow(await controller.addWsl("Debian"), "Debian")?.status).toBe(
      "added",
    );
    // Nothing to download, so the row never says it is downloading.
    expect(phases).toEqual(["checking", "linking"]);
    const before = await wslSnapshot(wsl);
    const again = await controller.addWsl("Ubuntu");

    expect(github.requests.filter((url) => url === ASSET_HOST)).toHaveLength(1);
    expect(distroRow(again, "Ubuntu")?.status).toBe("added");
    expect(await wslSnapshot(wsl)).toEqual(before);
    expect(JSON.parse(before.record!).wsl.distros).toEqual([
      "Ubuntu",
      "Debian",
    ]);
    const restarted = controllerWith({ exec: wsl }).controller;
    await restarted.reconcile();
    expect(
      (await restarted.state()).wsl?.distros.map((row) => row.status),
    ).toEqual(["added", "added"]);
  });

  it("says to add ~/.local/bin to the PATH when the login shell lacks it", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Arch: { loginPath: "/usr/local/bin:/usr/bin" } });
    const { controller } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();

    expect(distroRow(await controller.addWsl("Arch"), "Arch")).toMatchObject({
      status: "added",
      hint: "Add ~/.local/bin to your PATH in Arch.",
    });
  });

  it.each([
    [
      "digest_mismatch",
      "a digest mismatch",
      {},
      { digest: `sha256:${"0".repeat(64)}` },
      "The ajour download doesn't match its published checksum, so Ajour didn't install it.",
    ],
    [
      "wrong_version",
      "a wrong -V inside the distro",
      { versionOutput: "ajour 0.0.0" },
      {},
      `The downloaded ajour says "ajour 0.0.0", not "ajour ${VERSION}", so Ajour didn't add it.`,
    ],
    [
      "wrong_version",
      "a binary the distro can't run",
      {
        versionFailure: {
          code: 1,
          message: "execvpe(/mnt/c/…/ajour) failed: Exec format error",
        },
      },
      {},
      "The downloaded ajour didn't start in Ubuntu, so Ajour didn't add it.",
    ],
    [
      "wrong_version",
      "a binary that hangs",
      { versionFailure: { killed: true, message: "timed out" } },
      {},
      "The downloaded ajour didn't print its version within 10 seconds, so Ajour didn't add it.",
    ],
    [
      "foreign_command",
      "a foreign ~/.local/bin/ajour",
      { bin: true, entry: { file: "my own build" } },
      {},
      "Another ajour is at ~/.local/bin/ajour in Ubuntu. Remove it, then add again.",
    ],
    [
      "wsl_add_failed",
      "a distro that can't run wslpath",
      { failing: "wslpath" },
      {},
      "Ajour couldn't run commands in Ubuntu. Check that it starts, then try again.",
    ],
  ] as const)(
    "refuses %s (%s) with its own sentence and changes nothing",
    async (reason, _case, distro, asset, sentence) => {
      await installedBefore(VERSION);
      const wsl = fakeWsl({ Ubuntu: distro });
      const { events, recorded } = recordingEvents();
      const { controller } = controllerWith({
        exec: wsl,
        github: linuxRelease(asset),
      });
      await controller.state();
      const before = await wslSnapshot(wsl);

      const state = await events.run(
        "cli_command.wsl_add",
        { kind: "ipc", trigger: "user" },
        (unit: unknown) => controller.addWsl("Ubuntu", { unit }),
      );

      expect(distroRow(state, "Ubuntu")).toEqual({
        name: "Ubuntu",
        wslVersion: 2,
        status: "error",
        operation: "add",
        error: sentence,
        added: false,
      });
      expect(await wslSnapshot(wsl)).toEqual(before);
      const event = recorded.find(
        (candidate) => candidate.name === "cli_command.wsl_add",
      )!;
      expect(event.outcome_reason).toBe(reason);
      expect(event.outcome).toBe(
        reason === "wsl_add_failed" ? "error" : "refused",
      );
      // Neither the distro's name nor any path.
      const json = JSON.stringify(event);
      expect(json).not.toContain("Ubuntu");
      expect(json).not.toContain("/mnt/c");
      expect(json).not.toContain(root.replaceAll("\\", "\\\\"));
    },
  );

  it("refuses a distro that isn't in WSL's list, without entering any", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const { events, recorded } = recordingEvents();
    const { controller, github } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();
    const before = await wslSnapshot(wsl);

    await expect(
      events.run(
        "cli_command.wsl_add",
        { kind: "ipc", trigger: "user" },
        (unit: unknown) => controller.addWsl("Ubuntu; rm -rf ~", { unit }),
      ),
    ).rejects.toThrow(
      "Ajour can't find this distro in WSL's list any more. Reopen Settings to see the current list.",
    );

    expect(wsl.entered).toEqual([]);
    expect(github.requests).toEqual([]);
    // It read the list again, in case the cached one was stale.
    expect(wsl.lists).toHaveLength(2);
    expect(await wslSnapshot(wsl)).toEqual(before);
    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.wsl_add",
    )!;
    expect([event.outcome, event.outcome_reason]).toEqual([
      "refused",
      "unknown_distro",
    ]);
    expect(JSON.stringify(event)).not.toContain("rm -rf");
    // The next Add still runs.
    expect(distroRow(await controller.addWsl("Ubuntu"), "Ubuntu")?.status).toBe(
      "added",
    );
  });

  // The Linux ajour can't start in WSL 1 (#611).
  it("refuses a WSL 1 distro without downloading or entering it", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ "Ubuntu-24.04": { version: 1 } });
    const { events, recorded } = recordingEvents();
    const { controller, github } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();
    const before = await wslSnapshot(wsl);

    const state = await events.run(
      "cli_command.wsl_add",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.addWsl("Ubuntu-24.04", { unit }),
    );

    expect(distroRow(state, "Ubuntu-24.04")).toEqual({
      name: "Ubuntu-24.04",
      wslVersion: 1,
      status: "unsupported",
      reason:
        "WSL 1 isn't supported. Convert it with: wsl --set-version Ubuntu-24.04 2",
    });

    expect(github.requests).toEqual([]);
    expect(wsl.entered).toEqual([]);
    expect(await wslSnapshot(wsl)).toEqual(before);
    expect(existsSync(path.join(installDir, "linux"))).toBe(false);
    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.wsl_add",
    )!;
    expect([event.outcome, event.outcome_reason]).toEqual([
      "refused",
      "wsl1_unsupported",
    ]);
    expect(JSON.stringify(event)).not.toContain("Ubuntu");
  });

  it.each([
    [
      "a foreign ~/.local/bin/ajour",
      (distro: FakeDistro) => {
        distro.entry = { file: "my own build" };
      },
      "Another ajour is at ~/.local/bin/ajour in Ubuntu. Remove it, then add again.",
    ],
    [
      "a distro that can't run its shell",
      (distro: FakeDistro) => {
        distro.failing = "sh";
      },
      "Ajour couldn't run commands in Ubuntu. Check that it starts, then try again.",
    ],
  ] as const)(
    "keeps an added distro Added when adding it again fails on %s",
    async (_case, breakIt, sentence) => {
      await installedBefore(VERSION);
      const wsl = fakeWsl({ Ubuntu: {} });
      const { controller } = controllerWith({
        exec: wsl,
        github: linuxRelease(),
      });
      await controller.state();
      await controller.addWsl("Ubuntu");
      breakIt(wsl.distros.get("Ubuntu")!);
      const before = await wslSnapshot(wsl);

      const state = await controller.addWsl("Ubuntu");

      expect(state.wsl?.version).toBe(VERSION);
      expect(distroRow(state, "Ubuntu")).toEqual({
        name: "Ubuntu",
        wslVersion: 2,
        status: "error",
        operation: "add",
        error: sentence,
        added: true,
      });
      // The record, bin\linux, and whatever is at ~/.local/bin/ajour.
      expect(await wslSnapshot(wsl)).toEqual(before);
    },
  );

  it("restores an older Linux build unchanged when adding a newer one is refused", async () => {
    const OLDER = "0.0.1-nightly.20261103.293";
    await installedBefore(OLDER);
    const wsl = fakeWsl({
      Ubuntu: {},
      Debian: { versionOutput: "ajour 0.0.0" },
    });
    const older = controllerWith({
      exec: wsl,
      appVersion: OLDER,
      github: linuxRelease({}, OLDER),
    }).controller;
    await older.state();
    await older.addWsl("Ubuntu");
    const before = await wslSnapshot(wsl);
    const { controller } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();

    // Debian's -V is checked after the newer build is swapped in.
    const state = await controller.addWsl("Debian");

    expect(distroRow(state, "Debian")).toMatchObject({
      status: "error",
      added: false,
      error: `The downloaded ajour says "ajour 0.0.0", not "ajour ${VERSION}", so Ajour didn't add it.`,
    });
    expect(distroRow(state, "Ubuntu")?.status).toBe("added");
    expect(state.wsl?.version).toBe(OLDER);
    expect(await wslSnapshot(wsl)).toEqual(before);
    expect(
      await readFile(path.join(installDir, "linux", "ajour"), "utf8"),
    ).toBe(`binary ${OLDER}`);
    expect(
      (await readdir(installDir)).filter((name) =>
        /\.old-|\.staging-|\.pending-/.test(name),
      ),
    ).toEqual([]);
  });

  it("removes the link it made when a later step fails", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const before = await wslSnapshot(wsl);
    // The login PATH check runs after the link step.
    const run = wsl.exec;
    const exec = {
      ...wsl,
      exec: async (file: string, args: string[], options?: object) => {
        if (args.includes("-lc")) throw exited(1);
        return run(file, args, options);
      },
    };
    const failing = controllerWith({ exec, github: linuxRelease() }).controller;
    await failing.state();

    const state = await failing.addWsl("Ubuntu");

    expect(distroRow(state, "Ubuntu")).toMatchObject({
      status: "error",
      error:
        "Ajour couldn't run commands in Ubuntu. Check that it starts, then try again.",
    });
    expect(wsl.entered.map((entry) => entry.args[0])).toContain("-c");
    expect(await wslSnapshot(wsl)).toEqual(before);
    expect(wsl.distros.get("Ubuntu")).toMatchObject({
      bin: false,
      entry: null,
    });
  });

  it("restores bin\\linux from the record at launch", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const { controller } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();
    await controller.addWsl("Ubuntu");
    const linux = path.join(installDir, "linux");
    const committed = await filesUnder(linux);
    // An interrupted swap: the committed build set aside, another in place.
    await fs.rename(
      linux,
      `${linux}.old-${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`,
    );
    await mkdir(linux);
    await writeFile(path.join(linux, "ajour"), "binary 0.0.0");

    await controllerWith({ exec: wsl }).controller.reconcile();

    expect(await filesUnder(linux)).toEqual(committed);
    expect(await readFile(path.join(linux, "ajour"), "utf8")).toBe(
      `binary ${VERSION}`,
    );
  });

  it("deletes bin\\linux when the command is removed, so it can be installed again", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const { controller } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();
    await controller.addWsl("Ubuntu");

    expect((await controller.remove()).status).toBe("not-installed");

    expect(existsSync(path.join(installDir, "linux"))).toBe(false);
    const reinstalled = await controllerWith({
      exec: wsl,
    }).controller.install();
    expect(reinstalled).toMatchObject({ status: "installed", error: null });
    expect(JSON.parse(await readFile(recordFile, "utf8")).wsl).toBeUndefined();
  });

  it("records a successful Add on its event without the distro or a path", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const { events, recorded } = recordingEvents();
    const { controller } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();

    await events.run(
      "cli_command.wsl_add",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.addWsl("Ubuntu", { unit }),
    );

    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.wsl_add",
    )!;
    expect(event.outcome).toBe("ok");
    expect(event.cli_command).toEqual({ result: "installed" });
    const json = JSON.stringify(event);
    expect(json).not.toContain("Ubuntu");
    expect(json).not.toContain("/mnt/c");
    expect(json).not.toContain(root.replaceAll("\\", "\\\\"));
  });
});

/** The command installed, then added to each of `added` among `distros`. */
async function addedTo(
  added: string[],
  distros: Record<string, Partial<FakeDistro>> = Object.fromEntries(
    added.map((name) => [name, {}]),
  ),
) {
  await installedBefore(VERSION);
  const wsl = fakeWsl(distros);
  const { events, recorded } = recordingEvents();
  const { controller, github } = controllerWith({
    exec: wsl,
    github: linuxRelease(),
  });
  await controller.state();
  for (const name of added)
    expect(distroRow(await controller.addWsl(name), name)?.status).toBe(
      "added",
    );
  return { wsl, controller, github, events, recorded };
}

const linuxFolder = () => path.join(installDir, "linux");
const recordNow = async () =>
  existsSync(recordFile)
    ? JSON.parse(await readFile(recordFile, "utf8"))
    : null;
const leftovers = async () =>
  (await readdir(installDir)).filter((name) =>
    /\.old-|\.staging-|\.pending-|\.tmp$/.test(name),
  );

describe("removing the command from a WSL distro", () => {
  it("deletes the distro's link and keeps bin\\linux for the other distro", async () => {
    const { wsl, controller } = await addedTo(["Ubuntu", "Debian"]);
    const statuses: string[] = [];
    controller.onChange((state) => {
      const row = distroRow(state, "Ubuntu");
      if (row) statuses.push(row.status);
    });

    const state = await controller.removeWsl("Ubuntu");

    expect(statuses).toContain("removing");
    expect(distroRow(state, "Ubuntu")).toEqual({
      name: "Ubuntu",
      wslVersion: 2,
      status: "not-added",
    });
    expect(distroRow(state, "Debian")?.status).toBe("added");
    expect(wsl.distros.get("Ubuntu")!.entry).toBeNull();
    expect(wsl.distros.get("Debian")!.entry).toEqual({
      link: expect.stringMatching(/\/linux\/ajour$/),
    });
    expect((await recordNow()).wsl).toMatchObject({
      version: VERSION,
      distros: ["Debian"],
    });
    expect(await filesUnder(linuxFolder())).toContain("ajour");
    expect(await leftovers()).toEqual([]);
  });

  it("deletes bin\\linux with the last distro, and the record loses wsl", async () => {
    const { wsl, controller } = await addedTo(["Ubuntu"]);

    const state = await controller.removeWsl("Ubuntu");

    expect(distroRow(state, "Ubuntu")?.status).toBe("not-added");
    expect(state.wsl?.version).toBeUndefined();
    expect(wsl.distros.get("Ubuntu")!.entry).toBeNull();
    expect(existsSync(linuxFolder())).toBe(false);
    const record = await recordNow();
    expect(record.wsl).toBeUndefined();
    expect(record.version).toBe(VERSION);
    expect(existsSync(path.join(installDir, "ajour.exe"))).toBe(true);
    expect(await leftovers()).toEqual([]);
    // A later launch keeps it that way, and Add downloads the build again.
    await controllerWith({ exec: wsl }).controller.reconcile();
    expect(existsSync(linuxFolder())).toBe(false);
    expect(distroRow(await controller.addWsl("Ubuntu"), "Ubuntu")?.status).toBe(
      "added",
    );
    expect(await filesUnder(linuxFolder())).toContain("ajour");
  });

  it.each([
    ["someone's file", { file: "my own build" }],
    ["a link to another ajour", { link: "/opt/ajour/bin/ajour" }],
  ])(
    "leaves %s at ~/.local/bin/ajour, and the distro leaves the record",
    async (_case, entry) => {
      const { wsl, controller } = await addedTo(["Ubuntu"]);
      wsl.distros.get("Ubuntu")!.entry = entry;

      const state = await controller.removeWsl("Ubuntu");

      expect(distroRow(state, "Ubuntu")?.status).toBe("not-added");
      expect(wsl.distros.get("Ubuntu")!.entry).toEqual(entry);
      expect((await recordNow()).wsl).toBeUndefined();
    },
  );

  it("drops a distro WSL no longer has from the record without entering it", async () => {
    const { wsl, controller } = await addedTo(["Ubuntu", "Debian"]);
    // Unregistered since: WSL no longer lists it.
    wsl.distros.delete("Ubuntu");
    const entered = wsl.entered.length;

    const state = await controller.removeWsl("Ubuntu");

    expect(wsl.entered.slice(entered)).toEqual([]);
    expect(distroRow(state, "Ubuntu")).toBeUndefined();
    expect((await recordNow()).wsl.distros).toEqual(["Debian"]);
    expect(await filesUnder(linuxFolder())).toContain("ajour");
  });

  it("keeps the distro Added, with the reason and its record, when its link can't be removed", async () => {
    const { wsl, controller, events, recorded } = await addedTo(["Ubuntu"]);
    wsl.distros.get("Ubuntu")!.failing = "sh";
    const before = await wslSnapshot(wsl);

    const state = await events.run(
      "cli_command.wsl_remove",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.removeWsl("Ubuntu", { unit }),
    );

    expect(distroRow(state, "Ubuntu")).toEqual({
      name: "Ubuntu",
      wslVersion: 2,
      status: "error",
      operation: "remove",
      error:
        "Ajour couldn't run commands in Ubuntu. Check that it starts, then try again.",
      added: true,
    });
    expect(await wslSnapshot(wsl)).toEqual(before);
    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.wsl_remove",
    )!;
    expect([event.outcome, event.outcome_reason]).toEqual([
      "error",
      "wsl_remove_failed",
    ]);
    expect(event.cli_command).toEqual({ result: "failed" });
    const json = JSON.stringify(event);
    expect(json).not.toContain("Ubuntu");
    expect(json).not.toContain("/mnt/c");
    expect(json).not.toContain(root.replaceAll("\\", "\\\\"));

    // Retry, once the distro starts again.
    wsl.distros.get("Ubuntu")!.failing = undefined;
    expect(
      distroRow(await controller.removeWsl("Ubuntu"), "Ubuntu")?.status,
    ).toBe("not-added");
    expect(wsl.distros.get("Ubuntu")!.entry).toBeNull();
  });

  it("keeps the distro in the record when WSL can't list its distros", async () => {
    const { wsl } = await addedTo(["Ubuntu"]);
    const run = wsl.exec;
    const { controller } = controllerWith({
      exec: {
        ...wsl,
        exec: async (file: string, args: string[], options?: object) => {
          if (args[0] === "--list") throw exited(1, "WSL is broken.");
          return run(file, args, options);
        },
      },
    });
    const before = await wslSnapshot(wsl);

    const state = await controller.removeWsl("Ubuntu");

    expect(state.wsl).toBeUndefined();
    expect(await wslSnapshot(wsl)).toEqual(before);
    expect((await recordNow()).wsl.distros).toEqual(["Ubuntu"]);
  });

  it("refuses a distro that is neither in WSL's list nor in the record, entering none", async () => {
    const { wsl, controller, events, recorded } = await addedTo(["Ubuntu"]);
    const entered = wsl.entered.length;
    const before = await wslSnapshot(wsl);

    await expect(
      events.run(
        "cli_command.wsl_remove",
        { kind: "ipc", trigger: "user" },
        (unit: unknown) => controller.removeWsl("Ubuntu; rm -rf ~", { unit }),
      ),
    ).rejects.toThrow(
      "Ajour can't find this distro in WSL's list any more. Reopen Settings to see the current list.",
    );

    expect(wsl.entered.slice(entered)).toEqual([]);
    expect(await wslSnapshot(wsl)).toEqual(before);
    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.wsl_remove",
    )!;
    expect([event.outcome, event.outcome_reason]).toEqual([
      "refused",
      "unknown_distro",
    ]);
    expect(JSON.stringify(event)).not.toContain("rm -rf");
  });

  it("records a successful Remove on its event without the distro or a path", async () => {
    const { controller, events, recorded } = await addedTo(["Ubuntu"]);

    await events.run(
      "cli_command.wsl_remove",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.removeWsl("Ubuntu", { unit }),
    );

    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.wsl_remove",
    )!;
    expect(event.outcome).toBe("ok");
    expect(event.cli_command).toEqual({ result: "removed" });
    const json = JSON.stringify(event);
    expect(json).not.toContain("Ubuntu");
    expect(json).not.toContain("/mnt/c");
    expect(json).not.toContain(root.replaceAll("\\", "\\\\"));
  });

  it("runs after an Add under way, never beside it", async () => {
    await installedBefore(VERSION);
    const wsl = fakeWsl({ Ubuntu: {} });
    const { controller } = controllerWith({
      exec: wsl,
      github: linuxRelease(),
    });
    await controller.state();

    const [added, removed] = await Promise.all([
      controller.addWsl("Ubuntu"),
      controller.removeWsl("Ubuntu"),
    ]);

    expect(distroRow(added, "Ubuntu")?.status).toBe("added");
    expect(distroRow(removed, "Ubuntu")?.status).toBe("not-added");
    expect(wsl.distros.get("Ubuntu")!.entry).toBeNull();
    expect(existsSync(linuxFolder())).toBe(false);
  });
});

describe("removing the command with WSL distros added", () => {
  it("removes each recorded distro's link after the record and bin\\linux are gone", async () => {
    const { wsl } = await addedTo(["Ubuntu", "Debian"]);
    const run = wsl.exec;
    /** Whether the record and bin\linux were still there at each unlink. */
    const atUnlink: Array<{ record: boolean; linux: boolean }> = [];
    const exec = {
      ...wsl,
      exec: async (file: string, args: string[], options?: object) => {
        if (args[3] === "sh" && args.length === 10)
          atUnlink.push({
            record: existsSync(recordFile),
            linux: existsSync(linuxFolder()),
          });
        return run(file, args, options);
      },
    };
    const removing = controllerWith({ exec }).controller;

    const state = await removing.remove();

    expect(state.status).toBe("not-installed");
    expect(state.notice).toBeUndefined();
    expect(wsl.distros.get("Ubuntu")!.entry).toBeNull();
    expect(wsl.distros.get("Debian")!.entry).toBeNull();
    expect(atUnlink).toEqual([
      { record: false, linux: false },
      { record: false, linux: false },
    ]);
    expect(existsSync(installDir)).toBe(false);
    expect(existsSync(recordFile)).toBe(false);
  });

  it("names a link it couldn't remove, and removes the others", async () => {
    const { wsl, controller } = await addedTo(["Ubuntu", "Debian"]);
    wsl.distros.get("Debian")!.failing = "sh";

    const state = await controller.remove();

    expect(state.status).toBe("not-installed");
    expect(state.notice).toBe(
      "ajour was removed, but ~/.local/bin/ajour in Debian couldn't be. It now points at nothing.",
    );
    expect(state.error).toBeNull();
    expect(wsl.distros.get("Ubuntu")!.entry).toBeNull();
    expect(wsl.distros.get("Debian")!.entry).not.toBeNull();
    expect(existsSync(installDir)).toBe(false);
    expect(existsSync(recordFile)).toBe(false);
    // The next Install starts clean.
    expect((await controller.install()).notice).toBeUndefined();
  });

  // The deleted record commits the removal; nothing on disk names the
  // distros after it, so their links go even when cleaning up fails.
  it("removes the links even when cleaning up bin\\linux fails, and Retry names the one left", async () => {
    const { wsl } = await addedTo(["Ubuntu", "Debian"]);
    wsl.distros.get("Debian")!.failing = "sh";
    let busy = true;
    const files = fsWith({
      rm: (async (...args: Parameters<typeof fs.rm>) => {
        if (busy && path.resolve(String(args[0])) === linuxFolder())
          throw Object.assign(new Error("EBUSY: resource busy or locked"), {
            code: "EBUSY",
          });
        return fs.rm(...args);
      }) as never,
    });
    const { controller } = controllerWith({ exec: wsl, files });

    const failed = await controller.remove();

    expect(failed).toMatchObject({ status: "error", operation: "remove" });
    expect(existsSync(recordFile)).toBe(false);
    expect(wsl.distros.get("Ubuntu")!.entry).toBeNull();
    expect(wsl.distros.get("Debian")!.entry).not.toBeNull();

    busy = false;
    const state = await controller.remove();

    expect(state.status).toBe("not-installed");
    expect(state.notice).toBe(
      "ajour was removed, but ~/.local/bin/ajour in Debian couldn't be. It now points at nothing.",
    );
    expect(existsSync(installDir)).toBe(false);
  });

  it("names every link when WSL can't list its distros", async () => {
    const { wsl } = await addedTo(["Ubuntu", "Debian"]);
    const run = wsl.exec;
    const broken = controllerWith({
      exec: {
        ...wsl,
        exec: async (file: string, args: string[], options?: object) => {
          if (args[0] === "--list") throw exited(1, "WSL is broken.");
          return run(file, args, options);
        },
      },
    }).controller;

    const state = await broken.remove();

    expect(state.notice).toBe(
      "ajour was removed, but ~/.local/bin/ajour in Ubuntu and Debian couldn't be. It now points at nothing.",
    );
  });

  it("skips a recorded distro WSL no longer has, without entering or naming it", async () => {
    const { wsl, controller } = await addedTo(["Ubuntu", "Debian"]);
    wsl.distros.delete("Ubuntu");
    const entered = wsl.entered.length;

    const state = await controller.remove();

    expect(state.notice).toBeUndefined();
    expect(wsl.entered.slice(entered).map((run) => run.distro)).not.toContain(
      "Ubuntu",
    );
    expect(wsl.distros.get("Debian")!.entry).toBeNull();
  });

  it("counts the links it couldn't remove on cli_command.remove, without naming a distro", async () => {
    const { wsl, controller, events, recorded } = await addedTo([
      "Ubuntu",
      "Debian",
    ]);
    wsl.distros.get("Debian")!.failing = "sh";

    await events.run(
      "cli_command.remove",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.remove({ unit }),
    );

    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.remove",
    )!;
    expect(event.outcome).toBe("ok");
    expect(event.cli_command).toEqual({
      result: "removed",
      wsl_links_left: 1,
    });
    expect(JSON.stringify(event)).not.toContain("Debian");
  });
});

/** The version the launch before the update ran, with its Linux build. */
const OLDER = "0.0.1-nightly.20261103.293";
/** Where GitHub redirects the Linux build's download. */
const LINUX_HOST = `${ASSET_HOST}/linux`;

/**
 * The release of the app's version with both builds, `ajour.exe` and the
 * Linux one, each behind its own redirect. With `linuxMissing`, the Linux
 * asset isn't attached until `attach()`; `windows` can leave its own out.
 */
function fullRelease({
  linuxMissing = false,
  windows = fakeGithub(),
}: { linuxMissing?: boolean; windows?: ReturnType<typeof fakeGithub> } = {}) {
  const linux = fakeGithub({
    archive: linuxArchive(),
    asset: { name: LINUX_ASSET, browser_download_url: LINUX_DOWNLOAD },
    download: { redirect: LINUX_HOST },
  });
  let attached = !linuxMissing;
  const requests: string[] = [];
  const assetsOf = async (fake: typeof linux, url: string) =>
    ((await (await fake.fetch(url)).json()) as { assets: unknown[] }).assets;
  const fetch = async (
    url: string,
    init?: { redirect?: string; signal?: AbortSignal },
  ) => {
    requests.push(url);
    if (url.includes("/releases/tags/")) {
      const assets = [
        ...(await assetsOf(windows, url)),
        ...(attached ? await assetsOf(linux, url) : []),
      ];
      return response(
        200,
        url,
        Buffer.from(JSON.stringify({ tag_name: TAG, assets })),
      );
    }
    return (
      url === LINUX_DOWNLOAD || url === LINUX_HOST ? linux : windows
    ).fetch(url, init);
  };
  return {
    fetch,
    requests,
    inits: [],
    bytes: windows.bytes,
    attach: () => {
      attached = true;
    },
  };
}

/**
 * The launch before the update: ajour `OLDER` installed and added to each of
 * `added` among `distros`. What it ran in WSL is forgotten.
 */
async function addedBefore(
  added: string[],
  distros: Record<string, Partial<FakeDistro>> = Object.fromEntries(
    added.map((name) => [name, {}]),
  ),
) {
  await installedBefore(OLDER);
  const wsl = fakeWsl(distros);
  const older = controllerWith({
    exec: wsl,
    appVersion: OLDER,
    github: linuxRelease({}, OLDER),
  }).controller;
  await older.state();
  for (const name of added)
    expect(distroRow(await older.addWsl(name), name)?.status).toBe("added");
  await older.stop();
  wsl.lists.length = 0;
  wsl.entered.length = 0;
  return wsl;
}

const fileIn = (...names: string[]) =>
  readFile(path.join(installDir, ...names), "utf8");
const lookups = (github: { requests: string[] }) =>
  github.requests.filter((url) => url.includes("/releases/tags/")).length;

/** Renames of `bin\linux` fail as Windows fails them while a file is open. */
function busyLinuxFolder() {
  const lock = { busy: true };
  const files = fsWith({
    rename: async (source: string, target: string) => {
      if (lock.busy && source === linuxFolder())
        throw Object.assign(
          new Error("EBUSY: resource busy or locked, rename"),
          { code: "EBUSY" },
        );
      return fs.rename(source, target);
    },
  });
  return { files, lock };
}

describe("following the app version in WSL", () => {
  it("updates the Linux build after ajour.exe, checks -V in the first added distro only, and relinks nothing", async () => {
    const wsl = await addedBefore(["Ubuntu", "Debian"]);
    const links = structuredClone([...wsl.distros]);
    const { events, recorded } = recordingEvents();
    const { controller } = controllerWith({
      exec: wsl,
      github: fullRelease(),
      events,
    });

    const state = await controller.followAppVersion();

    expect(state).toMatchObject({ status: "installed", version: VERSION });
    expect(await fileIn("ajour.exe")).toBe(`binary ${VERSION}`);
    expect(await fileIn("linux", "ajour")).toBe(`binary ${VERSION}`);
    expect((await recordNow()).wsl).toEqual({
      version: VERSION,
      digests: { linux: expect.stringMatching(/^[0-9a-f]{64}$/) },
      distros: ["Ubuntu", "Debian"],
    });
    // Each link still points at bin\linux, which now holds the new build.
    expect([...wsl.distros]).toEqual(links);
    expect(
      wsl.entered.map(({ distro, program, args }) => [
        distro,
        program === "wslpath" ? "wslpath" : args.join(" "),
      ]),
    ).toEqual([
      ["Ubuntu", "wslpath"],
      ["Ubuntu", "-V"],
    ]);
    expect(await leftovers()).toEqual([]);
    const follows = recorded.filter(
      (event) => event.name === "cli_command.follow",
    );
    expect(
      follows.map((event) => [
        event.outcome,
        (event.cli_command as { target?: string }).target,
      ]),
    ).toEqual([
      ["ok", "windows"],
      ["ok", "linux"],
    ]);
    expect(JSON.stringify(follows)).not.toContain("Ubuntu");
    expect(JSON.stringify(follows)).not.toContain("/mnt/c");
  });

  it("shows the added distros updating, with the download's progress, while the Linux build follows", async () => {
    const wsl = await addedBefore(["Ubuntu"], { Ubuntu: {}, Debian: {} });
    const { controller } = controllerWith({ exec: wsl, github: fullRelease() });
    const seen: Array<{
      pending?: string;
      ubuntu?: NonNullable<CliState["wsl"]>["distros"][number];
      debian?: string;
    }> = [];
    controller.onChange((state) => {
      if (state.wsl)
        seen.push({
          pending: state.wsl.pending,
          ubuntu: distroRow(state, "Ubuntu"),
          debian: distroRow(state, "Debian")?.status,
        });
    });

    const state = await controller.followAppVersion();

    const updating = seen.filter((row) => row.ubuntu?.status === "updating");
    expect(updating.length).toBeGreaterThan(0);
    expect(
      updating.every(
        (row) => row.pending === VERSION && row.debian === "not-added",
      ),
    ).toBe(true);
    expect(updating.some((row) => (row.ubuntu?.progress ?? 0) > 0)).toBe(true);
    expect(state.wsl?.version).toBe(VERSION);
    expect(state.wsl?.pending).toBeUndefined();
    expect(distroRow(state, "Ubuntu")).toEqual({
      name: "Ubuntu",
      wslVersion: 2,
      status: "added",
    });
  });

  it("keeps the old Linux build when a running ajour holds its files, leaves ajour.exe's follow alone, and retries at the next launch", async () => {
    const wsl = await addedBefore(["Ubuntu"]);
    const { files, lock } = busyLinuxFolder();
    const { events, recorded } = recordingEvents();

    const state = await controllerWith({
      exec: wsl,
      github: fullRelease(),
      files,
      events,
    }).controller.followAppVersion();

    expect(state).toMatchObject({
      status: "installed",
      version: VERSION,
      error: null,
    });
    expect(state.wsl).toMatchObject({ version: OLDER, pending: VERSION });
    expect(distroRow(state, "Ubuntu")).toEqual({
      name: "Ubuntu",
      wslVersion: 2,
      status: "error",
      operation: "follow",
      added: true,
      error: "An ajour running in WSL is using its files.",
    });
    expect(await fileIn("ajour.exe")).toBe(`binary ${VERSION}`);
    expect(await fileIn("linux", "ajour")).toBe(`binary ${OLDER}`);
    expect(await recordNow()).toMatchObject({
      version: VERSION,
      wsl: { version: OLDER, distros: ["Ubuntu"] },
    });
    expect(await leftovers()).toEqual([]);
    const linuxFollow = recorded.find(
      (event) =>
        event.name === "cli_command.follow" &&
        (event.cli_command as { target?: string }).target === "linux",
    );
    expect([linuxFollow?.outcome, linuxFollow?.outcome_reason]).toEqual([
      "error",
      "files_in_use",
    ]);

    lock.busy = false;
    const next = await controllerWith({
      exec: wsl,
      github: fullRelease(),
    }).controller.followAppVersion();

    expect(await fileIn("linux", "ajour")).toBe(`binary ${VERSION}`);
    expect(distroRow(next, "Ubuntu")?.status).toBe("added");
    expect((await recordNow()).wsl.version).toBe(VERSION);
  });

  // Measured in the real app on WSL 2: right after `-V` ran the staged build
  // through /mnt/c, moving its folder failed with EPERM for under 300 ms.
  it("waits out the moment Windows holds the staged build after its -V check, and follows", async () => {
    const wsl = await addedBefore(["Ubuntu"]);
    let held = 2;
    const files = fsWith({
      rename: async (source: string, target: string) => {
        if (held > 0 && target === linuxFolder()) {
          held--;
          throw Object.assign(new Error("EPERM: operation not permitted"), {
            code: "EPERM",
          });
        }
        return fs.rename(source, target);
      },
    });

    const state = await controllerWith({
      exec: wsl,
      github: fullRelease(),
      files,
    }).controller.followAppVersion();

    expect(distroRow(state, "Ubuntu")?.status).toBe("added");
    expect(held).toBe(0);
    expect(await fileIn("linux", "ajour")).toBe(`binary ${VERSION}`);
    expect(await leftovers()).toEqual([]);
  });

  it("keeps the old Linux build, and says why, when the new one prints another version in the distro", async () => {
    const wsl = await addedBefore(["Ubuntu"]);
    wsl.distros.get("Ubuntu")!.versionOutput = "ajour 0.0.0";
    const before = await filesUnder(linuxFolder());

    const state = await controllerWith({
      exec: wsl,
      github: fullRelease(),
    }).controller.followAppVersion();

    expect(distroRow(state, "Ubuntu")).toMatchObject({
      status: "error",
      operation: "follow",
      added: true,
      error: `The downloaded ajour says "ajour 0.0.0", not "ajour ${VERSION}".`,
    });
    expect(await filesUnder(linuxFolder())).toEqual(before);
    expect(await fileIn("linux", "ajour")).toBe(`binary ${OLDER}`);
    expect(await fileIn("ajour.exe")).toBe(`binary ${VERSION}`);
    expect((await recordNow()).wsl.version).toBe(OLDER);
    expect(await leftovers()).toEqual([]);
  });

  it("checks -V in the first added distro WSL still lists", async () => {
    const wsl = await addedBefore(["Ubuntu", "Debian"]);
    wsl.distros.delete("Ubuntu");

    await controllerWith({
      exec: wsl,
      github: fullRelease(),
    }).controller.followAppVersion();

    expect(new Set(wsl.entered.map(({ distro }) => distro))).toEqual(
      new Set(["Debian"]),
    );
    expect(await fileIn("linux", "ajour")).toBe(`binary ${VERSION}`);
  });

  it("drops wsl from the record, and bin\\linux with it, when WSL lists no added distro, entering none", async () => {
    const wsl = await addedBefore(["Ubuntu"], { Ubuntu: {}, Debian: {} });
    wsl.distros.delete("Ubuntu");
    const github = fullRelease();

    const state = await controllerWith({
      exec: wsl,
      github,
    }).controller.followAppVersion();

    expect(state).toMatchObject({ status: "installed", version: VERSION });
    expect((await recordNow()).wsl).toBeUndefined();
    expect(existsSync(linuxFolder())).toBe(false);
    expect(wsl.entered).toEqual([]);
    expect(github.requests).not.toContain(LINUX_DOWNLOAD);
    expect(distroRow(state, "Debian")?.status).toBe("not-added");
    expect(await leftovers()).toEqual([]);
  });

  it("retries a missing Linux asset after five minutes, then hourly, on the follow's timer, without following ajour.exe again", async () => {
    const wsl = await addedBefore(["Ubuntu"]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const github = fullRelease({ linuxMissing: true });
    const { controller } = controllerWith({ exec: wsl, github });
    try {
      const first = await controller.followAppVersion();
      expect(first.version).toBe(VERSION);
      expect(distroRow(first, "Ubuntu")).toMatchObject({
        status: "error",
        operation: "follow",
      });
      expect(lookups(github)).toBe(2);

      await vi.advanceTimersByTimeAsync(299_999);
      expect(lookups(github)).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      // The timer started the retry: this joins it.
      await controller.followAppVersion();
      expect(lookups(github)).toBe(3);

      await vi.advanceTimersByTimeAsync(3_599_999);
      expect(lookups(github)).toBe(3);
      github.attach();
      await vi.advanceTimersByTimeAsync(1);
      const picked = await controller.followAppVersion();
      expect(lookups(github)).toBe(4);
      expect(distroRow(picked, "Ubuntu")?.status).toBe("added");
      expect(await fileIn("linux", "ajour")).toBe(`binary ${VERSION}`);
      expect(github.requests.filter((url) => url === DOWNLOAD)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(2 * 3_600_000);
      expect(lookups(github)).toBe(4);
    } finally {
      await controller.stop();
      vi.useRealTimers();
    }
  });

  it("retries once for both builds when both assets are missing", async () => {
    const wsl = await addedBefore(["Ubuntu"]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const github = fullRelease({
      linuxMissing: true,
      windows: fakeGithub({ release: { assets: [] } }),
    });
    const { controller } = controllerWith({ exec: wsl, github });
    try {
      await controller.followAppVersion();
      expect(lookups(github)).toBe(2);

      await vi.advanceTimersByTimeAsync(300_000);
      await controller.followAppVersion();
      expect(lookups(github)).toBe(4);
      await vi.advanceTimersByTimeAsync(3_599_999);
      expect(lookups(github)).toBe(4);
    } finally {
      await controller.stop();
      vi.useRealTimers();
    }
  });

  it("Retry from Settings follows only the Linux build once ajour.exe is current", async () => {
    const wsl = await addedBefore(["Ubuntu"]);
    const { files, lock } = busyLinuxFolder();
    const github = fullRelease();
    const { controller } = controllerWith({ exec: wsl, github, files });
    await controller.followAppVersion();
    lock.busy = false;

    const state = await controller.install();

    expect(distroRow(state, "Ubuntu")).toEqual({
      name: "Ubuntu",
      wslVersion: 2,
      status: "added",
    });
    expect(await fileIn("linux", "ajour")).toBe(`binary ${VERSION}`);
    expect(github.requests.filter((url) => url === DOWNLOAD)).toHaveLength(1);
  });

  it("runs nothing in WSL when no distro is added", async () => {
    await installedBefore(OLDER);
    const wsl = fakeWsl({ Ubuntu: {} });
    const github = fullRelease();

    const state = await controllerWith({
      exec: wsl,
      github,
    }).controller.followAppVersion();

    expect(state).toMatchObject({ status: "installed", version: VERSION });
    expect(wsl.lists).toEqual([]);
    expect(wsl.entered).toEqual([]);
    expect(github.requests).not.toContain(LINUX_DOWNLOAD);
  });

  it("runs nothing in a development build", async () => {
    const wsl = await addedBefore(["Ubuntu"]);
    const github = fullRelease();

    await controllerWith({
      exec: wsl,
      github,
      development: true,
    }).controller.followAppVersion();

    expect(github.requests).toEqual([]);
    expect(wsl.lists).toEqual([]);
    expect(wsl.entered).toEqual([]);
    expect(await fileIn("linux", "ajour")).toBe(`binary ${OLDER}`);
  });
});

it("Given the Linux release asset, the shared pipeline verifies and unpacks ajour", async () => {
  const {
    createReleaseAssetPipeline,
  } = require("./electron/cli-release-asset.cjs");
  const github = linuxRelease();
  const pipeline = createReleaseAssetPipeline({
    fetch: github.fetch,
    fs,
    exec: fakeExec().exec,
    paths: { tar: TAR },
    asset: LINUX_ASSET,
    binary: "ajour",
    appVersion: VERSION,
    label: "Linux",
    arch: "x64",
    signal: new AbortController().signal,
  });
  const resolved = await pipeline.resolveAsset({});
  const file = path.join(root, LINUX_ASSET);
  await pipeline.download(resolved, file);
  await pipeline.unpack(file, path.join(root, "unpacked"));
  expect(await readFile(path.join(root, "unpacked", "ajour"), "utf8")).toBe(
    `binary ${VERSION}`,
  );
});

// The link scripts in a real POSIX shell, with a temp folder as HOME.
// Windows has no shell with real symbolic links outside WSL; there the
// real-app check (`check:cli-command`) runs them in a WSL 2 distro, locally.
// CI's WSL 1 Ubuntu only checks the refusal (#611).
describe.runIf(process.platform !== "win32")(
  "the link step in a real shell",
  () => {
    let home: string;
    beforeEach(async () => {
      home = await mkdtemp(path.join(os.tmpdir(), "ajour-wsl-home-"));
    });
    afterEach(async () => {
      await rm(home, { recursive: true, force: true });
    });

    /** fakeWsl, with each `sh` run by /bin/sh in `home`. */
    function realShell({ failLogin = false } = {}) {
      const wsl = fakeWsl({ Ubuntu: {} });
      const exec = async (
        file: string,
        args: string[],
        options?: { timeout?: number },
      ) => {
        if (!file.endsWith("wsl.exe") || args[3] !== "sh")
          return wsl.exec(file, args, options);
        if (failLogin && args[4] === "-lc") throw exited(1);
        return await new Promise<{ stdout: string }>((resolve, reject) =>
          execFile(
            "/bin/sh",
            args.slice(4),
            { env: { HOME: home, PATH: "/usr/bin:/bin" } },
            (error, stdout) =>
              error
                ? reject(Object.assign(error, { code: error.code }))
                : resolve({ stdout }),
          ),
        );
      };
      return { ...wsl, exec };
    }
    const link = () => path.join(home, ".local", "bin", "ajour");

    it("links ~/.local/bin/ajour, then leaves its own link as it is", async () => {
      await installedBefore(VERSION);
      // As Ubuntu's ~/.profile does.
      await writeFile(
        path.join(home, ".profile"),
        'if [ -d "$HOME/.local/bin" ]; then PATH="$HOME/.local/bin:$PATH"; fi\n',
      );
      const wsl = realShell();
      const { controller } = controllerWith({
        exec: wsl,
        github: linuxRelease(),
      });
      await controller.state();

      const state = await controller.addWsl("Ubuntu");

      expect(distroRow(state, "Ubuntu")).toMatchObject({
        status: "added",
        hint: "Open a new Ubuntu terminal to use it.",
      });
      const target = await readlink(link());
      expect(target).toMatch(/^\/mnt\/c\/.*\/linux\/ajour$/);
      const before = await lstat(link());
      await controller.addWsl("Ubuntu");
      expect((await lstat(link())).ino).toBe(before.ino);
      expect(await readlink(link())).toBe(target);
    });

    it("says to add ~/.local/bin to the PATH when no profile adds it", async () => {
      await installedBefore(VERSION);
      const { controller } = controllerWith({
        exec: realShell(),
        github: linuxRelease(),
      });
      await controller.state();

      expect(distroRow(await controller.addWsl("Ubuntu"), "Ubuntu")?.hint).toBe(
        "Add ~/.local/bin to your PATH in Ubuntu.",
      );
    });

    it("refuses someone else's ~/.local/bin/ajour and leaves it alone", async () => {
      await installedBefore(VERSION);
      await mkdir(path.dirname(link()), { recursive: true });
      await writeFile(link(), "my own build");
      const { controller } = controllerWith({
        exec: realShell(),
        github: linuxRelease(),
      });
      await controller.state();

      expect(
        distroRow(await controller.addWsl("Ubuntu"), "Ubuntu")?.error,
      ).toBe(
        "Another ajour is at ~/.local/bin/ajour in Ubuntu. Remove it, then add again.",
      );
      expect(await readFile(link(), "utf8")).toBe("my own build");
    });

    it("removes the link and the folders it made when a later step fails", async () => {
      await installedBefore(VERSION);
      const { controller } = controllerWith({
        exec: realShell({ failLogin: true }),
        github: linuxRelease(),
      });
      await controller.state();

      expect(
        distroRow(await controller.addWsl("Ubuntu"), "Ubuntu")?.status,
      ).toBe("error");
      expect(await readdir(home)).toEqual([]);
    });

    /** Ubuntu added through the real shell, its link made by LINK_SCRIPT. */
    async function addedThroughShell() {
      await installedBefore(VERSION);
      const { controller } = controllerWith({
        exec: realShell(),
        github: linuxRelease(),
      });
      await controller.state();
      expect(
        distroRow(await controller.addWsl("Ubuntu"), "Ubuntu")?.status,
      ).toBe("added");
      return controller;
    }

    it("Remove deletes its own link and keeps ~/.local/bin", async () => {
      const controller = await addedThroughShell();

      const state = await controller.removeWsl("Ubuntu");

      expect(distroRow(state, "Ubuntu")?.status).toBe("not-added");
      expect(await readdir(path.dirname(link()))).toEqual([]);
    });

    it.each([
      ["someone's file", () => writeFile(link(), "my own build")],
      [
        "a link to another ajour",
        () => symlink("/opt/ajour/bin/ajour", link()),
      ],
    ])("Remove keeps %s at ~/.local/bin/ajour", async (_case, put) => {
      const controller = await addedThroughShell();
      await rm(link());
      await put();
      const before = await lstat(link());

      const state = await controller.removeWsl("Ubuntu");

      expect(distroRow(state, "Ubuntu")?.status).toBe("not-added");
      const after = await lstat(link());
      expect([after.ino, after.isSymbolicLink()]).toEqual([
        before.ino,
        before.isSymbolicLink(),
      ]);
    });

    it("Remove with nothing at ~/.local/bin/ajour exits 0 and drops the distro", async () => {
      const controller = await addedThroughShell();
      await rm(link());

      const state = await controller.removeWsl("Ubuntu");

      expect(distroRow(state, "Ubuntu")?.status).toBe("not-added");
      expect(existsSync(linuxFolder())).toBe(false);
    });
  },
);
