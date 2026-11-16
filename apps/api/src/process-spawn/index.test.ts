import { describe, expect, it } from "vitest";
import { resolveSpawn } from "./index.ts";

describe("resolveSpawn", () => {
  it("Given a NUL in an environment key, refuses", () => {
    expect(
      resolveSpawn(process.execPath, [], { ["bad\0key"]: "value" }),
    ).toEqual({ refused: "nul" });
  });
  // UTF-16 validation and fully qualified paths apply only to Windows.
  it.skipIf(process.platform !== "win32")(
    "Given an invalid environment value or root-relative executable, refuses",
    () => {
      expect(resolveSpawn(process.execPath, [], { VALUE: "\ud800" })).toEqual({
        refused: "invalid_unicode",
      });
      expect(resolveSpawn("\\Windows\\node.exe", [], {})).toEqual({
        refused: "absolute_path_required",
      });
    },
  );
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

  // Unix passthrough is intentionally unavailable on Windows.
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

  // These refusals depend on Windows CreateProcess semantics.
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
