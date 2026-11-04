import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { COMMANDS, GLOBAL_OPTIONS } from "./main.ts";
import {
  readPage,
  shortHelp,
  helpCard,
  roff,
  parsePage,
  type Page,
} from "./manual.ts";

type Options = Record<string, { type: string; short?: string }>;
function optionTokens(text: string): string[] {
  return [
    ...text.matchAll(
      /(?<![\w-])(--[a-zA-Z][a-zA-Z-]*|-[a-zA-Z])(?=$|[\s,\]\[|=.'"])/g,
    ),
  ].map(([token]) => token);
}
function checkOptions(page: Page, options: Options) {
  const tokens = (table: Options) =>
    Object.entries(table).flatMap(([name, option]) => [
      `--${name}`,
      ...(option.short ? [`-${option.short}`] : []),
    ]);
  const allowed = tokens({ ...GLOBAL_OPTIONS, ...options });
  for (const section of ["SYNOPSIS", "OPTIONS", "EXAMPLES"]) {
    const text = (page.sections[section] ?? "")
      .split("\n")
      .map((line) => {
        // Other commands in example pipelines have their own option tables.
        if (section !== "EXAMPLES") return line;
        const start = line.indexOf("ajour ");
        return start < 0 ? "" : line.slice(start).split(/\|(?!-)/)[0]!;
      })
      .join("\n");
    for (const token of optionTokens(text))
      expect(allowed, page.name).toContain(token);
  }
  const documented = optionTokens(page.sections.OPTIONS ?? "");
  for (const token of tokens(options))
    expect(documented, page.name).toContain(token);
}

describe("manual contracts", () => {
  it.each(["SYNOPSIS", "EXAMPLES"])(
    "rejects unknown short options in %s",
    (section) => {
      const page = parsePage(
        "sample",
        `SYNOPSIS\najour sample\nOPTIONS\n--summary\n${section}\najour sample ${section === "SYNOPSIS" ? "[-x]" : "-x"}\n`,
      );
      expect(() =>
        checkOptions(page, { summary: { type: "boolean" } }),
      ).toThrow();
    },
  );
  it("checks long options with equals values as whole tokens", () => {
    const options = { format: { type: "string" } };
    expect(() =>
      checkOptions(
        parsePage(
          "sample",
          "OPTIONS\n--format FORMAT\nEXAMPLES\najour sample --format=csv\n",
        ),
        options,
      ),
    ).not.toThrow();
    expect(() =>
      checkOptions(
        parsePage(
          "sample",
          "OPTIONS\n--format FORMAT\nEXAMPLES\najour sample --formatting=csv\n",
        ),
        options,
      ),
    ).toThrow();
  });
  it("requires a whole short alias in OPTIONS", () => {
    const page = parsePage(
      "sample",
      "SYNOPSIS\najour sample [-s]\nOPTIONS\n--summary\n",
    );
    expect(() =>
      checkOptions(page, { summary: { type: "boolean", short: "s" } }),
    ).toThrow();
  });

  it("escapes option, range and date hyphens as literal roff hyphens", async () => {
    expect(
      roff("sample", "EXAMPLES\najour log --format=tsv last-week 2026-11-04"),
    ).toContain("ajour log \\-\\-format=tsv last\\-week 2026\\-11\\-04");
    for (const name of ["ajour", ...Object.keys(COMMANDS)]) {
      const source = await readFile(
        new URL(`../docs/${name}.md`, import.meta.url),
        "utf8",
      );
      for (const [option] of source.matchAll(/--[a-z][a-z-]*/g))
        expect(roff(name, source)).toContain(option.replaceAll("-", "\\-"));
    }
  });
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
      checkOptions(page, options);
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
