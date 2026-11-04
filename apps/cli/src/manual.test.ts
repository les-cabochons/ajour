import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { COMMANDS, GLOBAL_OPTIONS } from "./main.ts";
import { readPage, shortHelp, helpCard, roff } from "./manual.ts";

describe("manual contracts", () => {
  it("documents every public command and exactly the parser's options", async () => {
    const names = Object.keys(COMMANDS).filter(
      (name) => !name.startsWith("__"),
    );
    expect((await readdir(new URL("../docs", import.meta.url))).sort()).toEqual(
      ["ajour", ...names].map((name) => `${name}.md`).sort(),
    );
    for (const name of ["ajour", ...names]) {
      const page = await readPage(name);
      const options =
        name === "ajour" ? GLOBAL_OPTIONS : COMMANDS[name]!.options;
      const documented = [
        ...page.sections.OPTIONS!.matchAll(/--([a-z][a-z-]*)/g),
      ].map((match) => match[1]);
      const allowed = { ...GLOBAL_OPTIONS, ...options };
      for (const option of documented)
        expect(Object.keys(allowed), name).toContain(option);
      for (const option of Object.keys(options))
        expect(documented, name).toContain(option);
      for (const match of Object.values(page.sections)
        .join("\n")
        .matchAll(/--([a-z][a-z-]*)/g))
        expect(Object.keys(allowed), name).toContain(match[1]);
      const shorts = Object.values(allowed).flatMap((option) =>
        "short" in option && option.short ? [option.short] : [],
      );
      for (const match of page.sections.OPTIONS!.matchAll(
        /(?:^|[\s,])-(\w)(?=[\s,]|$)/g,
      ))
        expect(shorts, name).toContain(match[1]);
      for (const option of Object.values(options)) {
        if (option.short)
          expect(page.sections.OPTIONS, name).toContain(`-${option.short}`);
      }
      expect(page.sections.SYNOPSIS, name).toContain(
        `ajour${name === "ajour" ? " " : ` ${name}`}`,
      );
    }
  });
  it("builds the grouped card and short help from page synopses", async () => {
    const card = await helpCard();
    for (const group of [
      "Running entry",
      "Entries",
      "Reading",
      "Setup",
      "Options",
    ])
      expect(card).toContain(group);
    for (const name of Object.keys(COMMANDS))
      expect(card).toMatch(new RegExp(`^  ${name}(?: |$)`, "m"));
    const page = await readPage("log");
    expect(card).toContain(
      page.sections
        .SYNOPSIS!.split("\n")[0]!
        .trim()
        .replace(/^ajour /, ""),
    );
    expect(shortHelp(page)).toContain("EXAMPLES");
    expect(shortHelp(page)).not.toContain("EXIT STATUS");
  });
  it.each(["ajour", "log"])("generates the %s manual as roff", async (name) => {
    const source = await readFile(
      new URL(`../docs/${name}.md`, import.meta.url),
      "utf8",
    );
    await expect(roff(name, source)).toMatchFileSnapshot(
      `test-support/${name}-golden.1`,
    );
  });
  it("generates literal roff without interpreting text as macros", async () => {
    const source = await readFile(
      new URL("./test-support/manual-source.txt", import.meta.url),
      "utf8",
    );
    const expected = await readFile(
      new URL("./test-support/manual-golden.1", import.meta.url),
      "utf8",
    );
    expect(roff("sample", source)).toBe(expected.replaceAll("\r\n", "\n"));
  });
});
