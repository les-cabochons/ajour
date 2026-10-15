import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findExecutable } from "./cli-path.ts";

describe("findExecutable", () => {
  it("finds an executable on PATH and skips folders without it", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "ajour-path-"));
    const bin = await mkdtemp(path.join(tmpdir(), "ajour-path-"));
    await writeFile(path.join(bin, "claude"), "#!/bin/sh\n");
    await chmod(path.join(bin, "claude"), 0o755);
    expect(
      await findExecutable(
        "claude",
        [empty, bin].join(path.delimiter),
        "darwin",
      ),
    ).toBe(path.join(bin, "claude"));
    expect(await findExecutable("codex", bin, "darwin")).toBeNull();
  });
});
