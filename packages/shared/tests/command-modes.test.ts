import { describe, expect, it } from "vitest";
import {
  displayCommandLine,
  displayCommandText,
  undeclaredCommandSchema,
} from "../command-modes.ts";

describe("displayCommandText", () => {
  it.each([
    ["C:\\Program Files\\Git\\cmd\\git.exe"],
    ["C:\\repo"],
    ["/home/me/My repo"],
    ["Café 'notes'"],
  ])("shows %j as-is", (value) => {
    expect(displayCommandText(value)).toBe(value);
  });

  it.each([
    ["x\u200by", "x\\u{200B}y"],
    ["x\u202ey", "x\\u{202E}y"],
    ["x\ty", "x\\u{9}y"],
    ["x\u00a0y", "x\\u{A0}y"],
    ["x\u3164y", "x\\u{3164}y"],
    ["x\u115fy", "x\\u{115F}y"],
    ["x\uffa0y", "x\\u{FFA0}y"],
    ["x\u034fy", "x\\u{34F}y"],
    ["x\ufe0fy", "x\\u{FE0F}y"],
    ["x\u2800y", "x\\u{2800}y"],
    ["x\ud800y", "x\\u{D800}y"],
    ["x\u0378y", "x\\u{378}y"],
    ["re\u00adport", "re\\u{AD}port"],
    ["👨\u200d👩", "👨\\u{200D}👩"],
    ["C:\\u{41}", "C:\\u{5C}u{41}"],
  ])("escapes %j", (value, shown) => {
    expect(displayCommandText(value)).toBe(shown);
  });
});

describe("displayCommandLine", () => {
  it("quotes only elements with spaces or quotes, so boundaries stay visible", () => {
    expect(
      displayCommandLine([
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "-C",
        "C:\\repo",
        "commit",
        "--message",
        'say "hi" & go',
        "",
      ]),
    ).toBe(
      '"C:\\Program Files\\Git\\cmd\\git.exe" -C C:\\repo commit --message "say \\"hi\\" & go" ""',
    );
  });

  it("keeps a backslash before a closing quote unambiguous", () => {
    expect(displayCommandLine(["a b\\", 'x\\"y'])).toBe(
      '"a b\\\\" "x\\\\\\"y"',
    );
  });

  it("escapes invisible characters inside elements", () => {
    expect(displayCommandLine(["a\u200bb", "c d\u2028"])).toBe(
      'a\\u{200B}b "c d\\u{2028}"',
    );
  });
});

describe("undeclared argv", () => {
  it.each([
    "x\u3164y",
    "x\u115fy",
    "x\uffa0y",
    "x\u034fy",
    "x\ufe0fy",
    "x\ud800y",
    "x\u0378y",
    "x\u200by",
    "x\u202ey",
    "x\ty",
  ])("refuses %j", (value) => {
    expect(
      undeclaredCommandSchema.safeParse({ executable: "git", argv: [value] })
        .success,
    ).toBe(false);
  });

  it.each(["C:\\Program Files\\x", "a  b & c", "Café", "x\u2800y"])(
    "accepts %j",
    (value) => {
      expect(
        undeclaredCommandSchema.safeParse({ executable: "git", argv: [value] })
          .success,
      ).toBe(true);
    },
  );
});
