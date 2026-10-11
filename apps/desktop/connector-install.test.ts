import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES, selectConnectorPluginArchive } =
  require("./electron/connector-install.cjs") as {
    MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES: number;
    selectConnectorPluginArchive: (
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

describe("desktop connector file selection", () => {
  it("returns no archive when the native file chooser is cancelled", async () => {
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: true,
        filePaths: [],
      }),
    };

    await expect(selectConnectorPluginArchive(dialog, {})).resolves.toBeNull();
  });

  it("reads the single connector archive selected by the user", async () => {
    const parentWindow = {};
    const archiveBytes = Buffer.from("connector-archive");
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ["/tmp/example.harday-connector"],
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
      selectConnectorPluginArchive(dialog, parentWindow, { open }),
    ).resolves.toEqual({
      archiveBytes,
      archiveFilename: "example.harday-connector",
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
        filePaths: ["/tmp/oversized.harday-connector"],
      }),
    };
    const archive = {
      stat: vi.fn().mockResolvedValue({
        isFile: () => true,
        size: MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES + 1,
      }),
      read: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const open = vi.fn().mockResolvedValue(archive);

    await expect(
      selectConnectorPluginArchive(dialog, {}, { open }),
    ).rejects.toThrow("Connector plugin archives must be between 1 byte");
    expect(archive.read).not.toHaveBeenCalled();
    expect(archive.close).toHaveBeenCalledOnce();
  });
});
