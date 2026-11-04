import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { roff } from "../src/manual.ts";
const docs = new URL("../docs/", import.meta.url);
const output = new URL("../dist/man/man1/", import.meta.url);
await mkdir(output, { recursive: true });
for (const file of (await readdir(docs))
  .filter((file) => file.endsWith(".md"))
  .sort()) {
  const name = file.slice(0, -3);
  await writeFile(
    new URL(`${name === "ajour" ? name : `ajour-${name}`}.1`, output),
    roff(name, await readFile(new URL(file, docs), "utf8")),
  );
}
