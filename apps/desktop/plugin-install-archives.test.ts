import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPluginArchive } from "../api/src/plugin-package.ts";

// plugin.install's result for an archive the local API's real installer
// refused. The installer marks what makes the archive itself invalid with the
// code `invalid_archive`; anything else is the machine failing.

/** A read of a staged plugin.json that fails as the next test asks. */
const manifestReadFailure = vi.hoisted(() => ({
  code: undefined as string | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (async (file: unknown, ...rest: unknown[]) => {
      const { code } = manifestReadFailure;
      if (code && String(file).endsWith(`${path.sep}plugin.json`)) {
        throw Object.assign(new Error(`${code}: cannot read plugin.json`), {
          code,
          syscall: "open",
          path: String(file),
        });
      }
      return (actual.readFile as (...args: unknown[]) => unknown)(
        file,
        ...rest,
      );
    }) as typeof actual.readFile,
  };
});

const require = createRequire(import.meta.url);
const { pluginInstallResultOf } = require("./electron/plugin-install.cjs") as {
  pluginInstallResultOf: (error: unknown) => string;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  manifestReadFailure.code = undefined;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const manifest = {
  id: "fixture",
  version: "1.0.0",
  apiVersion: 3,
  displayName: "Fixture",
  description: "Test plugin.",
  iconSvg: "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>",
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    { id: "label", label: "Connection label", type: "text", required: true },
    { id: "tenantLabel", label: "Workspace", type: "text", required: true },
  ],
};

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-archive-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** A gzipped tar of `files`, as a plugin archive is packaged. */
async function tarGz(files: Record<string, string>) {
  const directory = await temporaryDirectory();
  const source = path.join(directory, "source");
  await mkdir(source, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(source, name), contents);
  }
  const file = path.join(directory, "plugin.tgz");
  await create({ gzip: true, portable: true, cwd: source, file }, [
    ...Object.keys(files),
  ]);
  return await readFile(file);
}

const validPlugin = () =>
  tarGz({
    "plugin.json": JSON.stringify(manifest),
    "plugin.mjs": "export async function validateConnection() {}",
  });

/** The result plugin.install records when the real installer refuses `archive`. */
async function resultOf(archive: Buffer) {
  const installRoot = path.join(await temporaryDirectory(), "installed");
  const error = await installPluginArchive({
    archiveBytes: archive,
    archiveFilename: "fixture.ajour-connector",
    installRoot,
  }).then(
    () => {
      throw new Error("The archive installed.");
    },
    (refusal: unknown) => refusal,
  );
  return pluginInstallResultOf(error);
}

describe("an archive the installer refuses", () => {
  it.each([
    ["a file that is not gzip", async () => Buffer.from("not an archive")],
    ["gzip that holds no tar", async () => gzipSync("not a tar")],
    [
      "a truncated gzip",
      async () => {
        const archive = await validPlugin();
        return archive.subarray(0, Math.floor(archive.length / 2));
      },
    ],
    [
      "an archive without plugin.json",
      () => tarGz({ "plugin.mjs": "export {};" }),
    ],
    [
      "a plugin.json that is not JSON",
      () => tarGz({ "plugin.json": "{ nope", "plugin.mjs": "export {};" }),
    ],
    [
      "a manifest whose entrypoint is missing",
      () => tarGz({ "plugin.json": JSON.stringify(manifest) }),
    ],
  ])("records %s as an invalid archive", async (_case, build) => {
    await expect(resultOf(await build())).resolves.toBe("invalid_archive");
  });

  // A locked or full disk is the machine, not the package.
  it.each(["EPERM", "EBUSY", "ENOSPC", "EMFILE"])(
    "records %s while reading a valid manifest as a failure",
    async (code) => {
      const archive = await validPlugin();
      manifestReadFailure.code = code;

      await expect(resultOf(archive)).resolves.toBe("failed");
    },
  );

  it("installs the valid archive these cases start from", async () => {
    const installRoot = path.join(await temporaryDirectory(), "installed");

    await expect(
      installPluginArchive({
        archiveBytes: await validPlugin(),
        archiveFilename: "fixture.ajour-connector",
        installRoot,
      }),
    ).resolves.toMatchObject({ manifest: { id: "fixture" }, installed: true });
  });
});

describe("an install that fails after the archive was accepted", () => {
  // installPluginForServer saves Ajour's own state after the package change.
  it("records a corrupt Ajour state as a failure, not an invalid archive", async () => {
    const installRoot = path.join(await temporaryDirectory(), "installed");
    await installPluginArchive({
      archiveBytes: await validPlugin(),
      archiveFilename: "fixture.ajour-connector",
      installRoot,
    });
    const stateError = (() => {
      try {
        JSON.parse("{ corrupt state");
      } catch (error) {
        return error;
      }
    })();

    expect(pluginInstallResultOf(stateError)).toBe("failed");
  });
});
