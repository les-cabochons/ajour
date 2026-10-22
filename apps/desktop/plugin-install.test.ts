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
      pluginInstallResultOf: (error: unknown) => string;
    };
  const coded = (code: string, message = "") =>
    Object.assign(new Error(message), { code });

  // plugin-install-archives.test.ts runs the local API's real installer.
  it.each([
    [
      coded(
        "invalid_archive",
        "Plugin archives must be between 1 byte and 26214400 bytes.",
      ),
      "invalid_archive",
    ],
    [
      coded("not_available", 'Plugin "jira" is not available for download.'),
      "not_available",
    ],
    // Neither a message nor a type classifies an install any more.
    [new Error('Plugin "jira" is not available for download.'), "failed"],
    [new Error("Plugin archive contains an unsafe path: ../x"), "failed"],
    [new SyntaxError("Unexpected token } in JSON"), "failed"],
    [
      coded("TAR_BAD_ARCHIVE", "TAR_BAD_ARCHIVE: Unrecognized archive format"),
      "failed",
    ],
    [coded("ENOSPC", "ENOSPC: no space left on device"), "failed"],
    [
      coded("EACCES", "EACCES: permission denied, open 'plugin.json'"),
      "failed",
    ],
  ])("%s is %s", (error, result) => {
    expect(pluginInstallResultOf(error)).toBe(result);
  });
});
