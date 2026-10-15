import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playwrightMcpServer } from "./playwright-mcp.ts";

describe("playwrightMcpServer", () => {
  it("runs the bundled CLI with Ajour's Chrome profile", () => {
    const server = playwrightMcpServer({
      browserMode: "ajour-chrome",
      profileDirectory: "/p",
    });
    expect(server.command).toBe(process.execPath);
    const [script, ...flags] = server.args;
    expect(script).toMatch(/cli\.js$/);
    expect(existsSync(script!)).toBe(true);
    expect(flags).toEqual(["--browser", "chrome", "--user-data-dir", "/p"]);
  });

  it("uses the browser extension for the user's Chrome", () => {
    const { args } = playwrightMcpServer({
      browserMode: "my-chrome",
      profileDirectory: "/p",
    });
    expect(args.slice(1)).toEqual(["--extension"]);
  });
});
