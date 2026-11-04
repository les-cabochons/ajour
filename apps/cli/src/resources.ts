import { readFile } from "node:fs/promises";
import { UsageError } from "./errors.ts";

/** Development adapter. The bundle replaces this module with embedded resources. */
export async function version(): Promise<string> {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
}

export async function manualPage(name: string): Promise<string> {
  if (/^[a-z-]+$/.test(name)) {
    try {
      return await readFile(
        new URL(`../docs/${name}.md`, import.meta.url),
        "utf8",
      );
    } catch {
      /* Unknown page. */
    }
  }
  throw new UsageError(`No manual page for "${name}".`);
}
