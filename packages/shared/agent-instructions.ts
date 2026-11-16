export const INSTRUCTION_FILES = [
  { id: "codex", label: "Codex", path: ".codex/AGENTS.md" },
  { id: "opencode", label: "OpenCode", path: ".config/opencode/AGENTS.md" },
  { id: "claude", label: "Claude Code", path: ".claude/CLAUDE.md" },
  { id: "gemini", label: "Gemini CLI", path: ".gemini/GEMINI.md" },
  {
    id: "copilot",
    label: "Copilot CLI",
    path: ".copilot/copilot-instructions.md",
  },
] as const;
export type InstructionFileId = (typeof INSTRUCTION_FILES)[number]["id"];
export type InstructionAction = "add" | "update" | "remove";
export type InstructionStatus =
  "missing file" | "no block" | "block current" | "block outdated";
export interface InstructionFileState {
  id: InstructionFileId;
  path: string;
  status?: InstructionStatus;
  error?: string;
  notice?: string;
  readOnly?: boolean;
}
export interface InstructionPreview {
  token: string;
  before: string;
  after: string;
  notice?: string;
}
export const START_MARKER = "<!-- ajour:thread-naming -->";
export const END_MARKER = "<!-- /ajour:thread-naming -->";
export const THREAD_NAMING_BLOCK = `${START_MARKER}
## Thread naming
If you can rename your current thread/session (e.g. a T3 \`t3_thread_update\` tool, or similar) and you learn the ticket number this work is about (from the user, a branch, a PR, a file…), rename it to \`[<TICKET>] <current title>\` as soon as you learn it. Skip if the title already contains it. If you have no way to rename, ignore this rule silently.
${END_MARKER}`;

function blockRange(text: string) {
  const fragments = text.match(/<!--\s*\/?ajour:thread-naming/g) ?? [];
  const start = text.indexOf(START_MARKER);
  const end = text.indexOf(END_MARKER);
  if (start === -1 && end === -1) {
    if (/<!--\s*\/?ajour:thread-naming/.test(text))
      throw new Error(
        "Broken thread-naming markers. Repair them before continuing.",
      );
    return null;
  }
  if (
    fragments.length !== 2 ||
    start === -1 ||
    end < start ||
    text.indexOf(START_MARKER, start + 1) !== -1 ||
    text.indexOf(END_MARKER, end + 1) !== -1
  ) {
    throw new Error(
      "Duplicate or broken thread-naming markers. Repair them before continuing.",
    );
  }
  const stop = end + END_MARKER.length;
  if (
    (start > 0 && !["\n", "\uFEFF"].includes(text[start - 1]!)) ||
    text[end - 1] !== "\n" ||
    (stop < text.length && !["\n", "\r"].includes(text[stop]!))
  ) {
    throw new Error("Thread-naming markers must be on their own lines.");
  }
  return { start, stop };
}

export function instructionStatus(text: string | null): InstructionStatus {
  if (text === null) return "missing file";
  const range = blockRange(text);
  if (!range) return "no block";
  return text.slice(range.start, range.stop).replace(/\r\n/g, "\n") ===
    THREAD_NAMING_BLOCK
    ? "block current"
    : "block outdated";
}

/** Replaces only the managed span; Add appends a separator when needed. */
export function editInstructions(
  text: string | null,
  action: InstructionAction,
): string {
  const source = text ?? "";
  const range = blockRange(source);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const block = THREAD_NAMING_BLOCK.replace(/\n/g, eol);
  if (action === "add") {
    if (range) throw new Error("The block already exists. Reopen its preview.");
    const separator =
      source && source !== "\uFEFF" && !source.endsWith("\n") ? eol : "";
    // Record only the padding we own, so Remove never guesses about user whitespace.
    const padding = `<!-- ajour:padding=${separator ? 1 : 0} -->`;
    return source + separator + padding + eol + block + eol;
  }
  if (!range) throw new Error("The block is missing. Reopen its preview.");
  if (action === "remove") {
    const prefix = source.slice(0, range.start);
    const padding = prefix.match(/<!-- ajour:padding=([01]) -->(\r?\n)$/);
    if (padding) {
      const start =
        range.start -
        padding[0].length -
        (padding[1] === "1" ? padding[2]!.length : 0);
      const tail = source.slice(range.stop);
      return source.slice(0, start) + tail.replace(/^\r?\n/, "");
    }
  }
  return (
    source.slice(0, range.start) +
    (action === "remove" ? "" : block) +
    source.slice(range.stop)
  );
}
