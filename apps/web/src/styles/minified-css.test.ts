import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function styleSheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return styleSheets(file);
    return entry.name.endsWith(".css") ? [file] : [];
  });
}

/*
 * The build's CSS minifier (Lightning CSS, through Tailwind's Vite plugin)
 * drops `translate: none` beside `transform: none`. The dev server never
 * minifies, so every test passed while each floating composer shipped
 * shifted up and left by half its size: the dialog's centering
 * `-translate-x-1/2 -translate-y-1/2` came back. Cancel a Tailwind translate
 * through its variables, `--tw-translate-x: 0` and `--tw-translate-y: 0`,
 * which the minifier keeps.
 */
describe("stylesheets the build minifies", () => {
  it("never cancel a translate with `translate: none`", () => {
    const offenders = styleSheets(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .flatMap((line, index) =>
          /(^|[;{\s])translate:\s*none\b/.test(line)
            ? [`${path.relative(SRC, file)}:${index + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
