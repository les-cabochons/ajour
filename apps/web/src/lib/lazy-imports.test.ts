import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [file]
      : [];
  });
}

/*
 * A module imported both with import() and statically gets its own chunk
 * that the main chunk imports while that chunk imports back from it. The
 * bundled desktop renderer then runs it before its imports exist and the
 * window stays blank, which the dev server never shows (#615's DateField).
 */
describe("lazy imports", () => {
  it("never load a module that is also imported statically", () => {
    const files = sourceFiles(SRC).map((file) => ({
      file: path.relative(SRC, file).replaceAll("\\", "/"),
      text: readFileSync(file, "utf8"),
    }));
    const lazy = new Set(
      files.flatMap(({ text }) =>
        [...text.matchAll(/import\(\s*"(@\/[^"]+)"\s*\)/g)].map((m) => m[1]),
      ),
    );
    const mixed = files.flatMap(({ file, text }) =>
      [...text.matchAll(/from\s+"(@\/[^"]+)"/g)]
        .filter(
          (m) =>
            lazy.has(m[1]!) && !/^import\s+type\b/.test(lineOf(text, m.index!)),
        )
        .map((m) => `${file} imports ${m[1]} statically`),
    );
    expect(mixed).toEqual([]);
  });
});

function lineOf(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  // The import statement may start lines above its `from`.
  const statement = text.lastIndexOf("import", index);
  return text.slice(Math.min(start, statement), index);
}
