import { describe, expect, it } from "vitest";
import { resolveSpawn } from "./index.ts";

describe("resolveSpawn", () => {
  it("Given a native Node executable, preserves hostile arguments without a shell", () => {
    const argv = ['Fix login" & echo INJECTED & "', "%PATH%", "", "x\\"];
    expect(resolveSpawn(process.execPath, argv, {})).toEqual({
      command: process.execPath,
      args: argv,
      env: {},
    });
  });

  it("Given NUL, refuses before Node can truncate or reject the argument", () => {
    expect(resolveSpawn(process.execPath, ["a\0b"], {})).toEqual({
      refused: "nul",
    });
  });

  it.skipIf(process.platform === "win32")(
    "Given a non-Windows executable, leaves argv and environment unchanged",
    () => {
      const argv = ["%PATH%", "!VAR!", "\r\n", "", "-title"];
      expect(resolveSpawn("./tool", argv, { PATH: "/bin" })).toEqual({
        command: "./tool",
        args: argv,
        env: { PATH: "/bin" },
      });
    },
  );

  it.skipIf(process.platform !== "win32")(
    "Given an unresolved Windows command or excessive command line, refuses",
    () => {
      expect(resolveSpawn("tool.cmd", [], {})).toEqual({
        refused: "absolute_path_required",
      });
      expect(resolveSpawn(process.execPath, ["x".repeat(33000)], {})).toEqual({
        refused: "command_line_too_long",
      });
      expect(resolveSpawn(process.execPath, ["\ud800"], {})).toEqual({
        refused: "invalid_unicode",
      });
    },
  );
});
