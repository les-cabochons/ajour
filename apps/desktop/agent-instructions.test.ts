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
async function fixture(env: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-instructions-"));
  homes.push(home);
  return {
    home,
    controller: createInstructionController({ home, editor, env }),
  };
}
it("previews without writing, then creates a known file", async () => {
  const { home, controller } = await fixture();
  expect((await controller.list())[0].status).toBe("missing file");
  const preview = await controller.preview("codex", "add");
  await expect(readFile(path.join(home, ".codex/AGENTS.md"))).rejects.toThrow();
  await controller.apply("codex", preview.token);
  expect(await readFile(path.join(home, ".codex/AGENTS.md"), "utf8")).toBe(
    "<!-- ajour:padding=0 -->\n" + editor.THREAD_NAMING_BLOCK + "\n",
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
      "\uFEFFUser rules\r\n<!-- ajour:padding=0 -->\r\n" +
        editor.THREAD_NAMING_BLOCK.replace(/\n/g, "\r\n") +
        "\r\n",
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

it("refuses UTF-32 and invalid Unicode without changing the file", async () => {
  const { home, controller } = await fixture();
  await mkdir(path.join(home, ".codex"));
  const file = path.join(home, ".codex/AGENTS.md");
  for (const bytes of [
    Buffer.from([0xff, 0xfe, 0, 0, 65, 0, 0, 0]),
    Buffer.from([0xff, 0xfe, 0, 0xd8]),
    Buffer.from([0xc0, 0xaf]),
  ]) {
    await writeFile(file, bytes);
    await expect(controller.preview("codex", "add")).rejects.toThrow();
    expect(await readFile(file)).toEqual(bytes);
  }
});

it("uses a non-empty Codex override for status, preview and writes", async () => {
  const { home, controller } = await fixture();
  await mkdir(path.join(home, ".codex"));
  const base = path.join(home, ".codex/AGENTS.md");
  const override = path.join(home, ".codex/AGENTS.override.md");
  await writeFile(base, "Base rules");
  await writeFile(override, "Override rules");
  expect((await controller.list())[0]).toMatchObject({
    path: override,
    status: "no block",
  });
  const preview = await controller.preview("codex", "add");
  expect(preview.before).toBe("Override rules");
  await controller.apply("codex", preview.token);
  expect(await readFile(base, "utf8")).toBe("Base rules");
  expect(await readFile(override, "utf8")).toContain(
    editor.THREAD_NAMING_BLOCK,
  );
  await writeFile(override, "");
  expect((await controller.list())[0].path).toBe(base);
});

it("resolves location variables and Gemini's context filename without changing settings", async () => {
  const { home } = await fixture();
  const env = {
    CODEX_HOME: path.join(home, "codex"),
    CLAUDE_CONFIG_DIR: path.join(home, "claude"),
    GEMINI_CLI_HOME: path.join(home, "gemini"),
    OPENCODE_CONFIG_DIR: path.join(home, "open"),
    XDG_CONFIG_HOME: path.join(home, "xdg"),
    COPILOT_HOME: path.join(home, "copilot"),
  };
  const controller = createInstructionController({ home, env, editor });
  const settings = path.join(env.GEMINI_CLI_HOME, ".gemini/settings.json");
  await mkdir(path.dirname(settings), { recursive: true });
  const json = '{"context":{"fileName":"RULES.md"}}';
  await writeFile(settings, json);
  for (const [id, file] of Object.entries({
    codex: path.join(env.CODEX_HOME, "AGENTS.md"),
    claude: path.join(env.CLAUDE_CONFIG_DIR, "CLAUDE.md"),
    gemini: path.join(env.GEMINI_CLI_HOME, ".gemini/RULES.md"),
    opencode: path.join(env.OPENCODE_CONFIG_DIR, "AGENTS.md"),
    copilot: path.join(env.COPILOT_HOME, "copilot-instructions.md"),
  })) {
    expect(
      (await controller.list()).find(
        (row: editor.InstructionFileState) => row.id === id,
      )?.path,
    ).toBe(file);
    const preview = await controller.preview(id, "add");
    await controller.apply(id, preview.token);
    expect(await readFile(file, "utf8")).toContain(editor.THREAD_NAMING_BLOCK);
  }
  expect(await readFile(settings, "utf8")).toBe(json);
  delete (env as Partial<typeof env>).OPENCODE_CONFIG_DIR;
  expect(
    (await controller.list()).find(
      (row: editor.InstructionFileState) => row.id === "opencode",
    ).path,
  ).toBe(path.join(env.XDG_CONFIG_HOME, "opencode/AGENTS.md"));
  await writeFile(settings, "{broken");
  expect(
    (await controller.list()).find(
      (row: editor.InstructionFileState) => row.id === "gemini",
    ).error,
  ).toMatch(/settings.json/);
  await expect(controller.preview("gemini", "add")).rejects.toThrow(
    /settings.json/,
  );
});

it("warns that creating OpenCode instructions replaces its Claude fallback", async () => {
  const { home, controller } = await fixture();
  await mkdir(path.join(home, ".claude"));
  const claude = path.join(home, ".claude/CLAUDE.md");
  await writeFile(claude, editor.THREAD_NAMING_BLOCK);
  const row = (await controller.list()).find(
    (row: editor.InstructionFileState) => row.id === "opencode",
  );
  expect(row.notice).toMatch(/already covers OpenCode/);
  const preview = await controller.preview("opencode", "add");
  expect(preview.notice).toMatch(/stop reading/);
  await controller.apply("opencode", preview.token);
  expect(
    (await controller.list()).find(
      (row: editor.InstructionFileState) => row.id === "opencode",
    ).notice,
  ).toBeUndefined();
  expect(await readFile(claude, "utf8")).toBe(editor.THREAD_NAMING_BLOCK);
});
it("lists read-only files and refuses access-denied or foreign-owned replacements", async () => {
  const { home } = await fixture();
  await mkdir(path.join(home, ".codex"));
  const file = path.join(home, ".codex/AGENTS.md");
  await writeFile(file, "Rules");
  const fs = await import("node:fs/promises");
  for (const options of [
    {
      io: {
        ...fs,
        access: async () => {
          throw new Error("denied");
        },
      },
    },
    { userId: 987654 },
  ]) {
    const controller = createInstructionController({
      home,
      editor,
      env: {},
      ...options,
    });
    expect((await controller.list())[0].readOnly).toBe(true);
    await expect(controller.preview("codex", "add")).rejects.toThrow(
      /read-only/i,
    );
    expect(await readFile(file, "utf8")).toBe("Rules");
  }
});

it("refuses a preview if Codex switches to an override before confirmation", async () => {
  const { home, controller } = await fixture();
  const preview = await controller.preview("codex", "add");
  await mkdir(path.join(home, ".codex"));
  const override = path.join(home, ".codex/AGENTS.override.md");
  await writeFile(override, "New override");
  await expect(controller.apply("codex", preview.token)).rejects.toThrow(
    /preview/,
  );
  expect(await readFile(override, "utf8")).toBe("New override");
});
