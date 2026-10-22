import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { create, replace } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPluginArchive } from "../api/src/plugin-package.ts";
import {
  installPluginForServer,
  startAppApiServer,
  stopAppApiServer,
} from "../api/src/server.ts";

// plugin.install's result for an archive the local API's real installer
// refused. The installer marks what makes the archive itself invalid with the
// code `invalid_archive`; anything else is the machine or Ajour failing.

/** File system failures the next test asks for, as Node raises them. */
const failures = vi.hoisted(() => ({
  /** Reading a staged plugin.json fails with this code. */
  manifestRead: undefined as string | undefined,
  /** The staged archive cannot be opened, as when antivirus quarantined it. */
  stagedArchiveGone: false,
  /** The extraction folder is gone when the manifest is read. */
  extractionFolderGone: false,
}));

function systemError(code: string, syscall: string, file: string) {
  return Object.assign(new Error(`${code}: ${syscall} '${file}'`), {
    code,
    syscall,
    path: file,
  });
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (async (file: unknown, ...rest: unknown[]) => {
      const code = failures.manifestRead;
      if (code && String(file).endsWith(`${path.sep}plugin.json`)) {
        throw systemError(code, "open", String(file));
      }
      return (actual.readFile as (...args: unknown[]) => unknown)(
        file,
        ...rest,
      );
    }) as typeof actual.readFile,
    realpath: (async (file: unknown, ...rest: unknown[]) => {
      if (
        failures.extractionFolderGone &&
        String(file).endsWith(`${path.sep}payload`)
      ) {
        throw systemError("ENOENT", "realpath", String(file));
      }
      return (actual.realpath as (...args: unknown[]) => unknown)(
        file,
        ...rest,
      );
    }) as typeof actual.realpath,
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { Readable } = await import("node:stream");
  return {
    ...actual,
    createReadStream: ((file: unknown, ...rest: unknown[]) => {
      if (
        failures.stagedArchiveGone &&
        String(file).endsWith(".ajour-connector")
      ) {
        const stream = new Readable({ read() {} });
        queueMicrotask(() =>
          stream.destroy(systemError("ENOENT", "open", String(file))),
        );
        return stream;
      }
      return (actual.createReadStream as (...args: unknown[]) => unknown)(
        file,
        ...rest,
      );
    }) as typeof actual.createReadStream,
  };
});

const require = createRequire(import.meta.url);
const { pluginInstallResultOf } = require("./electron/plugin-install.cjs") as {
  pluginInstallResultOf: (error: unknown) => string;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  failures.manifestRead = undefined;
  failures.stagedArchiveGone = false;
  failures.extractionFolderGone = false;
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

  // tar refuses to write the entry `x/y` over the file `x`, in its mkdir.
  it("records an archive whose entries clash as an invalid archive", async () => {
    const directory = await temporaryDirectory();
    const asFile = path.join(directory, "file");
    const asFolder = path.join(directory, "folder");
    await mkdir(path.join(asFolder, "x"), { recursive: true });
    await mkdir(asFile, { recursive: true });
    await writeFile(path.join(asFile, "x"), "a file");
    await writeFile(path.join(asFolder, "x", "y"), "inside a folder");
    const tarFile = path.join(directory, "clash.tar");
    await create({ file: tarFile, cwd: asFile, portable: true }, ["x"]);
    await replace({ file: tarFile, cwd: asFolder, portable: true }, ["x/y"]);

    await expect(resultOf(gzipSync(await readFile(tarFile)))).resolves.toBe(
      "invalid_archive",
    );
  });

  // Only a file missing inside the extracted archive is the archive's fault.
  it("records a staged archive that vanished, as antivirus quarantines it, as a failure", async () => {
    const archive = await validPlugin();
    failures.stagedArchiveGone = true;

    await expect(resultOf(archive)).resolves.toBe("failed");
  });

  it("records an extraction folder that vanished as a failure", async () => {
    const archive = await validPlugin();
    failures.extractionFolderGone = true;

    await expect(resultOf(archive)).resolves.toBe("failed");
  });

  // A locked or full disk is the machine, not the package.
  it.each(["EPERM", "EBUSY", "ENOSPC", "EMFILE"])(
    "records %s while reading a valid manifest as a failure",
    async (code) => {
      const archive = await validPlugin();
      failures.manifestRead = code;

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
  // installPluginForServer reads Ajour's own state to apply the new plugin's
  // activation, and a corrupt state file throws a SyntaxError there.
  it("records a corrupt Ajour state as a failure, not an invalid archive", async () => {
    const directory = await temporaryDirectory();
    const statePath = path.join(directory, "state.json");
    await writeFile(statePath, "{ corrupt state");
    const server = await startAppApiServer({
      host: "127.0.0.1",
      port: 0,
      statePath,
      installedPluginDirectory: path.join(directory, "plugins"),
      developmentPluginDirectories: [],
      bundledPluginArchives: [],
      allowDevelopmentPlugins: false,
      projectDataShapePluginDirectories: [],
    });
    try {
      const error = await installPluginForServer(
        server,
        await validPlugin(),
        "fixture.ajour-connector",
        { enableAfterInstall: false },
      ).then(
        () => {
          throw new Error("The plugin installed.");
        },
        (refusal: unknown) => refusal,
      );

      expect(error).toBeInstanceOf(SyntaxError);
      expect(pluginInstallResultOf(error)).toBe("failed");
    } finally {
      await stopAppApiServer(server);
    }
  });
});
