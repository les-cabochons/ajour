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
  onChange(listener: (state: CliState) => void): () => void;
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
  download?: { redirect?: string; status?: number; extraBytes?: number };
} = {}) {
  const bytes = Buffer.from(JSON.stringify(archive));
  const served = Buffer.concat([
    bytes,
    Buffer.alloc(download.extraBytes ?? 0, 1),
  ]);
  const requests: string[] = [];
  const inits: Array<{ redirect?: string } | undefined> = [];
  const redirectTo = download.redirect ?? ASSET_HOST;
  const fetch = async (url: string, init?: { redirect?: string }) => {
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
    return response(download.status ?? 200, url, served);
  };
  return { fetch, requests, inits, bytes };
}

function response(
  status: number,
  url: string,
  body: Buffer,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(body.toString("utf8")),
    // Three chunks, so a download reports progress.
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const third = Math.ceil(body.byteLength / 3);
        for (let start = 0; start < body.byteLength; start += third) {
          controller.enqueue(
            new Uint8Array(body.subarray(start, start + third)),
          );
        }
        controller.close();
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

function fakeLink({ fail = false } = {}) {
  const added: string[] = [];
  return {
    added,
    link: {
      async add(folder: string) {
        if (fail) throw new Error("PowerShell exited with 1.");
        added.push(folder);
        return { added: true };
      },
    },
  };
}

function controllerWith({
  github = fakeGithub(),
  exec = fakeExec(),
  link = fakeLink(),
  platform = "win32",
  arch = "x64",
  appVersion = VERSION,
  development = false,
  releaseOrigin,
}: {
  github?: ReturnType<typeof fakeGithub>;
  exec?: ReturnType<typeof fakeExec>;
  link?: ReturnType<typeof fakeLink>;
  platform?: string;
  arch?: string;
  appVersion?: string;
  development?: boolean;
  releaseOrigin?: string;
} = {}) {
  const controller = createCliCommandController({
    fetch: github.fetch,
    fs,
    exec: exec.exec,
    platform,
    arch,
    appVersion,
    development,
    releaseOrigin,
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
  await mkdir(path.join(installDir, "man", "man1"), { recursive: true });
  await writeFile(path.join(installDir, "ajour.exe"), `binary ${version}`);
  await writeFile(
    path.join(installDir, "man", "man1", "ajour.1"),
    "old manual",
  );
  await mkdir(path.dirname(recordFile), { recursive: true });
  const record = {
    version,
    binaryPath: path.join(installDir, "ajour.exe"),
    link: "path",
    installedAt: "2026-11-01T09:00:00.000Z",
  };
  await writeFile(recordFile, JSON.stringify(record));
  return record;
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
      "completions/ajour.bash",
      "man/man1/ajour.1",
    ]);
    expect(link.added).toEqual([installDir]);
    // The check ran the unpacked binary, before it moved into place.
    const check = exec.calls.find((call) => call.args[0] === "-V")!;
    expect(check.file).not.toBe(path.join(installDir, "ajour.exe"));
    expect(JSON.parse(await readFile(recordFile, "utf8"))).toEqual({
      version: VERSION,
      binaryPath: path.join(installDir, "ajour.exe"),
      link: "path",
      installedAt: "2026-11-04T10:00:00.000Z",
    });
  });

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
      "completions/ajour.bash",
      "man/man1/ajour.1",
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

    const state = await events.run(
      "cli_command.install",
      { kind: "ipc", trigger: "user" },
      (unit: unknown) => controller.install({ unit }),
    );

    expect(await filesUnder(installDir)).toEqual(filesBefore);
    if (before) {
      expect(JSON.parse(await readFile(recordFile, "utf8"))).toEqual(before);
      expect(await readFile(path.join(installDir, "ajour.exe"), "utf8")).toBe(
        `binary ${previous}`,
      );
      // No staging folder, no old copy left.
      expect(await readdir(installDir)).toEqual(["ajour.exe", "man"]);
    } else {
      expect(existsSync(path.join(root, "Local"))).toBe(false);
      expect(existsSync(recordFile)).toBe(false);
    }
    const event = recorded.find(
      (candidate) => candidate.name === "cli_command.install",
    )!;
    return { state, event, link };
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
      expect(link.added).toEqual([]);
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

  it("puts the previous install back when the PATH can't be changed", async () => {
    const { state, event } = await refused(
      { link: fakeLink({ fail: true }) },
      "0.0.1-nightly.20261101.280",
    );

    expect(state.error).toBe(
      "Ajour couldn't add ajour to your PATH, so nothing changed.",
    );
    expect(event.outcome).toBe("error");
  });

  it("removes what it made when the PATH can't be changed on a first install", async () => {
    const { state } = await refused({ link: fakeLink({ fail: true }) });

    expect(state).toEqual({
      status: "error",
      progress: null,
      error: "Ajour couldn't add ajour to your PATH, so nothing changed.",
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

  it("is unsupported on macOS until it links /usr/local/bin (#569)", async () => {
    const { controller } = controllerWith({
      platform: "darwin",
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
