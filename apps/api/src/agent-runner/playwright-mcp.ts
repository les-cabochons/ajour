import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { AgentBrowserMode } from "../../../../packages/shared/agent-runs.ts";
import type { StdioServerSpec } from "./adapter.ts";

const require = createRequire(import.meta.url);

/**
 * The bundled Playwright MCP's CLI script. Never `npx @latest`. The package
 * does not export `cli.js`, so read the path from its `bin` entry.
 */
function playwrightMcpCli(): string {
  const packageJsonPath = require.resolve("@playwright/mcp/package.json");
  const { bin } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    bin: Record<string, string>;
  };
  return path.join(path.dirname(packageJsonPath), bin["playwright-mcp"]!);
}

/**
 * Playwright MCP as a stdio server the CLI starts, run by the app's own
 * Node. In Electron, `process.execPath` is the Electron binary, which acts
 * as Node with ELECTRON_RUN_AS_NODE.
 */
export function playwrightMcpServer({
  browserMode,
  profileDirectory,
}: {
  browserMode: AgentBrowserMode;
  profileDirectory: string;
}): StdioServerSpec {
  const browserArgs =
    browserMode === "my-chrome"
      ? ["--extension"]
      : ["--browser", "chrome", "--user-data-dir", profileDirectory];
  return {
    command: process.execPath,
    args: [playwrightMcpCli(), ...browserArgs],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  };
}
