import { afterEach, expect, it } from "vitest";
import { showManual, type Reader } from "./manual-reader.ts";
import { ajour, closeTerminals } from "./test-support/terminal.ts";
afterEach(closeTerminals);
it.each([true, false])(
  "uses installed man when available = %s",
  async (installed) => {
    const term = await ajour({});
    term.io.stdout.isTTY = true;
    const calls: { command: string; args: string[]; input?: string }[] = [];
    const reader: Reader = async (command, args, input) => {
      calls.push({ command, args, input });
      return command === "man" ? installed : true;
    };
    await showManual("log", term.io, reader);
    expect(calls[0]).toEqual({
      command: "man",
      args: ["1", "ajour-log"],
      input: undefined,
    });
    if (!installed) {
      expect(calls[1]?.command).toBe("less");
      expect(calls[1]?.args).toEqual(["-R"]);
      expect(calls[1]?.input).toContain("EXIT STATUS");
    } else expect(calls).toHaveLength(1);
    expect(term.out()).toBe("");
  },
);
it("passes a quoted PAGER path and its arguments without invoking a shell", async () => {
  const term = await ajour({});
  term.io.stdout.isTTY = true;
  term.io.env = { PAGER: '"/my reader/pager" -R' };
  const calls: string[][] = [];
  await showManual("log", term.io, async (command, args) => {
    calls.push([command, ...args]);
    return command !== "man";
  });
  expect(calls[1]).toEqual(["/my reader/pager", "-R"]);
});
it("falls back to stdout when both readers are absent and never invokes readers in a pipe", async () => {
  const term = await ajour({});
  let calls = 0;
  const reader: Reader = async () => {
    calls++;
    return false;
  };
  await showManual("log", term.io, reader);
  expect(calls).toBe(0);
  expect(term.out()).toContain("SYNOPSIS");
  term.clear();
  term.io.stdout.isTTY = true;
  await showManual("log", term.io, reader);
  expect(calls).toBe(2);
  expect(term.out()).toContain("EXIT STATUS");
});
