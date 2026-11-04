import { spawn } from "node:child_process";
import type { CliIo } from "./io.ts";
import { pageText, readPage } from "./manual.ts";

/** An external reader's process boundary, injectable for terminal tests. */
export type Reader = (
  command: string,
  args: string[],
  input?: string,
) => Promise<boolean>;
export function processReader(io: CliIo): Reader {
  return (command, args, input) =>
    new Promise((resolve) => {
      const child = spawn(command, args, {
        env: { ...io.env },
        stdio: [input === undefined ? "inherit" : "pipe", "inherit", "ignore"],
        windowsHide: true,
      });
      child.on("error", () => resolve(false));
      child.stdin?.on("error", () => undefined);
      child.on("close", (code) => resolve(code === 0));
      if (input !== undefined) child.stdin?.end(input);
    });
}

/** Split a PAGER command into argv, preserving quoted paths and arguments. */
export function pagerArgs(value: string): string[] {
  return (value.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? []).map((part) =>
    part.replace(/^("|')(.*)\1$/, "$2"),
  );
}
export async function showManual(
  name: string,
  io: CliIo,
  reader: Reader = processReader(io),
): Promise<void> {
  const page = await readPage(name);
  const text = pageText(page);
  if (io.stdout.isTTY) {
    const man = name === "ajour" ? "ajour" : `ajour-${name}`;
    if (await reader("man", ["1", man])) return;
    const [command, ...args] = pagerArgs(io.env.PAGER?.trim() || "less -R");
    if (command && (await reader(command, args, text))) return;
  }
  io.stdout.write(text);
}
