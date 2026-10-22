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

  it.each([
    [
      new Error('Plugin "jira" is not available for download.'),
      "download",
      "not_available",
    ],
    [
      new Error("No compatible release asset is available for Jira."),
      "download",
      "not_available",
    ],
    [new Error("Plugin download returned HTTP 503."), "download", "failed"],
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
    [new Error("EACCES: permission denied"), "install", "failed"],
  ])("%s at %s is %s", (error, step, result) => {
    expect(pluginInstallResultOf(error, step)).toBe(result);
  });
});
