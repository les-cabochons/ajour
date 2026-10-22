import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { MAX_PLUGIN_ARCHIVE_BYTES, selectPluginArchive } =
  require("./electron/plugin-install.cjs") as {
    MAX_PLUGIN_ARCHIVE_BYTES: number;
    selectPluginArchive: (
      dialog: {
        showOpenDialog: ReturnType<typeof vi.fn>;
      },
      parentWindow: object,
      dependencies?: {
        open: ReturnType<typeof vi.fn>;
      },
    ) => Promise<{
      archiveBytes: Buffer;
      archiveFilename: string;
    } | null>;
  };

describe("desktop plugin file selection", () => {
  it("returns no archive when the native file chooser is cancelled", async () => {
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: true,
        filePaths: [],
      }),
    };

    await expect(selectPluginArchive(dialog, {})).resolves.toBeNull();
  });

  it("reads the single plugin archive selected by the user", async () => {
    const parentWindow = {};
    const archiveBytes = Buffer.from("connector-archive");
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ["/tmp/example.ajour-connector"],
      }),
    };
    let read = false;
    const archive = {
      stat: vi.fn().mockResolvedValue({
        isFile: () => true,
        size: archiveBytes.byteLength,
      }),
      read: vi.fn().mockImplementation(async (buffer: Buffer) => {
        if (read) {
          return { bytesRead: 0 };
        }
        read = true;
        archiveBytes.copy(buffer);
        return { bytesRead: archiveBytes.byteLength };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const open = vi.fn().mockResolvedValue(archive);

    await expect(
      selectPluginArchive(dialog, parentWindow, { open }),
    ).resolves.toEqual({
      archiveBytes,
      archiveFilename: "example.ajour-connector",
    });
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      parentWindow,
      expect.objectContaining({ properties: ["openFile"] }),
    );
  });

  it("rejects an oversized archive before reading it", async () => {
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ["/tmp/oversized.ajour-connector"],
      }),
    };
    const archive = {
      stat: vi.fn().mockResolvedValue({
        isFile: () => true,
        size: MAX_PLUGIN_ARCHIVE_BYTES + 1,
      }),
      read: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const open = vi.fn().mockResolvedValue(archive);

    await expect(selectPluginArchive(dialog, {}, { open })).rejects.toThrow(
      "Plugin archives must be between 1 byte",
    );
    expect(archive.read).not.toHaveBeenCalled();
    expect(archive.close).toHaveBeenCalledOnce();
  });
});

describe("an install's result as its event records it", () => {
  const { pluginInstallResultOf } =
    require("./electron/plugin-install.cjs") as {
      pluginInstallResultOf: (error: unknown, step: string) => string;
    };
  const named = (name: string, message = "") =>
    Object.assign(new Error(message), { name });

  const coded = (code: string, message: string) =>
    Object.assign(new Error(message), { code });

  it.each([
    // Desktop's own errors carry a code.
    [
      coded(
        "invalid_archive",
        "Plugin archives must be between 1 byte and 26214400 bytes.",
      ),
      "select",
      "invalid_archive",
    ],
    [
      coded("not_available", 'Plugin "jira" is not available for download.'),
      "download",
      "not_available",
    ],
    // Text alone no longer classifies a download.
    [
      new Error('Plugin "jira" is not available for download.'),
      "download",
      "failed",
    ],
    [new Error("Plugin download returned HTTP 503."), "download", "failed"],
    // A system error is a failure, whatever its message names.
    [
      coded(
        "EACCES",
        "EACCES: permission denied, open 'C:/plugins/jira/plugin.json'",
      ),
      "install",
      "failed",
    ],
    [
      coded(
        "ENOSPC",
        "ENOSPC: no space left on device, write 'jira.ajour-connector'",
      ),
      "install",
      "failed",
    ],
    [
      coded("ENOENT", "ENOENT: no such file, open 'archive'"),
      "select",
      "failed",
    ],
    // The local API's installer: its validation messages, until it has codes.
    [
      new Error("Another plugin package change is already in progress."),
      "install",
      "busy",
    ],
    [
      new Error(
        "Wait for active plugin operations to finish before installing a plugin.",
      ),
      "install",
      "busy",
    ],
    [named("ZodError"), "install", "invalid_archive"],
    [named("IncompatiblePluginError"), "install", "invalid_archive"],
    [
      new Error("Plugin archive contains an unsafe path: ../x"),
      "install",
      "invalid_archive",
    ],
    [
      new Error('Plugin "jira" entrypoint must be compiled JavaScript.'),
      "install",
      "invalid_archive",
    ],
    [new Error("Manifest file is over 64 KB."), "install", "invalid_archive"],
    [new Error("Could not write the plugin's manifest."), "install", "failed"],
  ])("%s at %s is %s", (error, step, result) => {
    expect(pluginInstallResultOf(error, step)).toBe(result);
  });
});

// Bad archives as the local API's real installer refuses them.
describe("the installer's refusals", () => {
  const { pluginInstallResultOf } =
    require("./electron/plugin-install.cjs") as {
      pluginInstallResultOf: (error: unknown, step: string) => string;
    };

  async function refusal(build: (directory: string) => Promise<Buffer>) {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { installPluginArchive } =
      await import("../api/src/plugin-package.ts");
    const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-archive-"));
    try {
      const archiveBytes = await build(directory);
      return await installPluginArchive({
        archiveBytes,
        archiveFilename: "broken.ajour-connector",
        installRoot: path.join(directory, "installed"),
      }).then(
        () => {
          throw new Error("The archive installed.");
        },
        (error: unknown) => error,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async function tarGz(directory: string, files: Record<string, string>) {
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { create } = await import("tar");
    const source = path.join(directory, "source");
    await mkdir(source, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(path.join(source, name), contents);
    }
    const file = path.join(directory, "plugin.tgz");
    await create({ gzip: true, cwd: source, file }, Object.keys(files));
    return await readFile(file);
  }

  it.each([
    ["a file that is not gzip", async () => Buffer.from("not an archive")],
    [
      "gzip that holds no tar",
      async () => (await import("node:zlib")).gzipSync("not a tar"),
    ],
    [
      "an archive without plugin.json",
      (directory: string) => tarGz(directory, { "index.js": "export {};" }),
    ],
    [
      "a plugin.json that is not JSON",
      (directory: string) => tarGz(directory, { "plugin.json": "{ nope" }),
    ],
  ])("records %s as an invalid archive", async (_case, build) => {
    const error = await refusal(build);

    expect(pluginInstallResultOf(error, "install")).toBe("invalid_archive");
  });

  it("keeps a system error outside the archive a failure", () => {
    const error = Object.assign(new Error("ENOSPC: no space left on device"), {
      code: "ENOSPC",
      path: "C:/plugins/.install-1/plugin.ajour-connector",
    });

    expect(pluginInstallResultOf(error, "install")).toBe("failed");
  });
});
