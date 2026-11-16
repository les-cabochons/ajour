const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function decode(bytes) {
  if (bytes === null)
    return { text: null, encode: (text) => Buffer.from(text, "utf8") };
  const be = bytes[0] === 0xfe && bytes[1] === 0xff;
  const le = bytes[0] === 0xff && bytes[1] === 0xfe;
  if (be || le) {
    if (bytes.length % 2)
      throw new Error("Invalid UTF-16 file. No changes made.");
    const copy = Buffer.from(bytes);
    if (be) copy.swap16();
    const text = copy.toString("utf16le");
    return {
      text,
      encode: (value) => {
        const result = Buffer.from(value, "utf16le");
        return be ? result.swap16() : result;
      },
    };
  }
  // Validate without stripping the BOM, which belongs to the user's text.
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (bytes.includes(0))
    throw new Error("Unsupported file encoding. No changes made.");
  return {
    text: bytes.toString("utf8"),
    encode: (text) => Buffer.from(text, "utf8"),
  };
}

/** All paths come from the fixed catalog. Tests inject a disposable home. */
function createInstructionController({ home, editor }) {
  const pending = new Map();
  let writing = Promise.resolve();
  const load = async () =>
    typeof editor === "function" ? await editor() : editor;
  async function target(id) {
    const module = await load();
    const file = module.INSTRUCTION_FILES.find((entry) => entry.id === id);
    if (!file) throw new Error("Unknown agent instruction file.");
    return { module, file: path.join(home, file.path) };
  }
  async function read(file) {
    try {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1)
        throw new Error(
          "Instruction file must be a regular file, without links.",
        );
      if (info.size > 1024 * 1024)
        throw new Error("Instruction file exceeds 1 MB. No changes made.");
      return { bytes: await fs.readFile(file), mode: info.mode };
    } catch (error) {
      if (error.code === "ENOENT") return { bytes: null, mode: 0o600 };
      throw error;
    }
  }
  return {
    async list() {
      const module = await load();
      return Promise.all(
        module.INSTRUCTION_FILES.map(async (entry) => {
          const { file } = await target(entry.id);
          try {
            return {
              id: entry.id,
              path: file,
              status: module.instructionStatus(
                decode((await read(file)).bytes).text,
              ),
            };
          } catch (error) {
            return { id: entry.id, path: file, error: error.message };
          }
        }),
      );
    },
    async preview(id, action) {
      const { module, file } = await target(id);
      if (!["add", "update", "remove"].includes(action))
        throw new Error("Unknown instruction action.");
      const { bytes } = await read(file);
      const decoded = decode(bytes);
      const after = module.editInstructions(decoded.text, action);
      const token = randomUUID();
      pending.set(id, { token, bytes, next: decoded.encode(after) });
      return { token, before: decoded.text ?? "", after };
    },
    async apply(id, token) {
      const run = async () => {
        const { file } = await target(id);
        const preview = pending.get(id);
        if (!preview || preview.token !== token)
          throw new Error("Reopen the preview before saving.");
        const current = await read(file);
        if (
          current.bytes === null
            ? preview.bytes !== null
            : preview.bytes === null || !current.bytes.equals(preview.bytes)
        )
          throw new Error(
            "The file changed. Reopen the preview before saving.",
          );
        if (current.bytes && !(current.mode & 0o222))
          throw new Error(
            "The instruction file is read-only. No changes made.",
          );
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, preview.next, {
            flag: "wx",
            mode: current.mode & 0o777,
          });
          // Recheck after preparing the replacement, before the atomic rename.
          const latest = await read(file);
          if (
            latest.bytes === null
              ? current.bytes !== null
              : current.bytes === null || !latest.bytes.equals(current.bytes)
          )
            throw new Error(
              "The file changed. Reopen the preview before saving.",
            );
          await fs.rename(temporary, file);
          pending.delete(id);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      };
      const result = writing.then(run);
      writing = result.catch(() => {});
      return result;
    },
  };
}

function registerInstructionIpc(ipc, controller, assertSender) {
  ipc.handle("ajour:instruction-list", async (event) => {
    assertSender(event, "read agent instructions");
    return controller.list();
  });
  ipc.handle("ajour:instruction-preview", async (event, id, action) => {
    assertSender(event, "preview agent instructions");
    return controller.preview(id, action);
  });
  ipc.handle("ajour:instruction-apply", async (event, id, token) => {
    assertSender(event, "change agent instructions");
    return controller.apply(id, token);
  });
}
module.exports = { createInstructionController, registerInstructionIpc };
