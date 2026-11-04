import { build } from "vite";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const pages = Object.fromEntries(
  await Promise.all(
    (await readdir(path.join(root, "docs")))
      .filter((n) => n.endsWith(".md"))
      .map(async (n) => [
        n.slice(0, -3),
        await readFile(path.join(root, "docs", n), "utf8"),
      ]),
  ),
);
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const version = process.env.RELEASE_TAG?.replace(/^v/, "") ?? manifest.version;
await build({
  configFile: false,
  root,
  ssr: { noExternal: true },
  define: { AJOUR_BUNDLED: "true" },
  plugins: [
    {
      name: "embedded-cli-resources",
      load(id) {
        if (id === path.join(root, "src/resources.ts").replaceAll("\\", "/"))
          return `
      import { UsageError } from "./errors.ts";
      export async function version() { return ${JSON.stringify(version)}; }
      const pages = ${JSON.stringify(pages)};
      export async function manualPage(name) {
        if (Object.hasOwn(pages, name)) return pages[name];
        throw new UsageError('No manual page for "' + name + '".');
      }`;
      },
    },
  ],
  build: {
    ssr: true,
    target: "node24",
    minify: false,
    lib: {
      entry: path.join(root, "src/bundled.ts"),
      formats: ["cjs"],
      fileName: () => "ajour.cjs",
    },
    rolldownOptions: {
      platform: "node",
      output: {
        format: "cjs",
        entryFileNames: "ajour.cjs",
        inlineDynamicImports: true,
      },
    },
  },
});
