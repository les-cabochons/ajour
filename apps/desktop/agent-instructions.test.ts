import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  chmod,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import * as editor from "../../packages/shared/agent-instructions";
import { recordingEvents } from "./recording-events";
const require = createRequire(import.meta.url);
const {
  createInstructionController,
  registerInstructionIpc,
} = require("./electron/agent-instructions.cjs");
const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0))
    await rm(home, { recursive: true, force: true });
});
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-instructions-"));
  homes.push(home);
  return { home, controller: createInstructionController({ home, editor }) };
}
it("previews without writing, then creates a known file", async () => {
  const { home, controller } = await fixture();
  expect((await controller.list())[0].status).toBe("missing file");
  const preview = await controller.preview("codex", "add");
  await expect(readFile(path.join(home, ".codex/AGENTS.md"))).rejects.toThrow();
  await controller.apply("codex", preview.token);
  expect(await readFile(path.join(home, ".codex/AGENTS.md"), "utf8")).toBe(
    editor.THREAD_NAMING_BLOCK,
  );
  await expect(controller.preview("../secret", "add")).rejects.toThrow(
    /Unknown/,
  );
});
it("preserves UTF-16 BOM and CRLF and refuses stale previews", async () => {
  const { home, controller } = await fixture();
  await mkdir(path.join(home, ".claude"));
  const file = path.join(home, ".claude/CLAUDE.md");
  const original = Buffer.from("\uFEFFUser rules\r\n", "utf16le");
  await writeFile(file, original);
  const preview = await controller.preview("claude", "add");
  await controller.apply("claude", preview.token);
  expect(await readFile(file)).toEqual(
    Buffer.from(
      "\uFEFFUser rules\r\n" +
        editor.THREAD_NAMING_BLOCK.replace(/\n/g, "\r\n"),
      "utf16le",
    ),
  );
  const removal = await controller.preview("claude", "remove");
  await writeFile(file, original);
  await expect(controller.apply("claude", removal.token)).rejects.toThrow(
    /changed/,
  );
  expect(await readFile(file)).toEqual(original);
});
it("refuses a read-only file without changing it", async () => {
  const { home, controller } = await fixture();
  await mkdir(path.join(home, ".codex"));
  const file = path.join(home, ".codex/AGENTS.md");
  await writeFile(file, "User rules\n");
  const preview = await controller.preview("codex", "add");
  await chmod(file, 0o444);
  try {
    await expect(controller.apply("codex", preview.token)).rejects.toThrow(
      /read.only|permission/i,
    );
    expect(await readFile(file, "utf8")).toBe("User rules\n");
  } finally {
    await chmod(file, 0o644);
  }
});
it("checks the active sender before touching the controller", async () => {
  const handlers = new Map();
  const { controller } = await fixture();
  registerInstructionIpc(
    {
      handle: (channel: string, handler: unknown) =>
        handlers.set(channel, handler),
    },
    controller,
    (event: unknown) => {
      if (event !== "window") throw new Error("foreign sender");
    },
  );
  await expect(
    handlers.get("ajour:instruction-preview")("foreign", "codex", "add"),
  ).rejects.toThrow(/sender/);
  await expect(
    handlers.get("ajour:instruction-preview")("window", "unknown", "add"),
  ).rejects.toThrow(/Unknown/);
});

it.each(["utf8", "utf16be"])(
  "updates and removes only the managed span in %s",
  async (encoding) => {
    const { home, controller } = await fixture();
    await mkdir(path.join(home, ".gemini"));
    const file = path.join(home, ".gemini/GEMINI.md");
    const encode = (text: string) =>
      encoding === "utf8"
        ? Buffer.from(text)
        : Buffer.from(text, "utf16le").swap16();
    const before = "\uFEFF# Rules\r\nKeep two spaces.  \r\n";
    const after = "\r\n# Footer\r\n";
    await writeFile(
      file,
      encode(
        before +
          editor.START_MARKER +
          "\r\nold\r\n" +
          editor.END_MARKER +
          after,
      ),
    );
    expect(
      (await controller.list()).find(
        (row: editor.InstructionFileState) => row.id === "gemini",
      ).status,
    ).toBe("block outdated");
    const update = await controller.preview("gemini", "update");
    await controller.apply("gemini", update.token);
    expect(await readFile(file)).toEqual(
      encode(
        before + editor.THREAD_NAMING_BLOCK.replace(/\n/g, "\r\n") + after,
      ),
    );
    const removal = await controller.preview("gemini", "remove");
    await controller.apply("gemini", removal.token);
    expect(await readFile(file)).toEqual(encode(before + after));
  },
);

it("the restricted IPC rejects a foreign session and records no contents", async () => {
  const { controller } = await fixture();
  const handlers = new Map();
  const { events, recorded } = recordingEvents();
  const session = {};
  const sender = { session };
  const { createIpcListeners } = require("./electron/ipc-listeners.cjs");
  const ipc = createIpcListeners(
    {
      handle: (channel: string, handler: unknown) =>
        handlers.set(channel, handler),
    },
    { events, windowSession: () => session },
  );
  registerInstructionIpc(ipc, controller, (event: { sender: unknown }) => {
    if (event.sender !== sender) throw new Error("foreign sender");
  });
  await expect(
    Promise.resolve().then(() =>
      handlers.get("ajour:instruction-list")({ sender: { session: {} } }),
    ),
  ).rejects.toThrow(/window/);
  const preview = await handlers.get("ajour:instruction-preview")(
    { sender },
    "codex",
    "add",
  );
  await handlers.get("ajour:instruction-apply")(
    { sender },
    "codex",
    preview.token,
  );
  expect(recorded).toHaveLength(3);
  expect(JSON.stringify(recorded)).not.toContain("## Thread naming");
});
