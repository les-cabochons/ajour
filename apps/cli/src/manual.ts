import { manualPage } from "./resources.ts";
import { padEnd } from "./format/text.ts";

export interface Page {
  name: string;
  sections: Record<string, string>;
}

/** Uppercase headings delimit literal, hand-aligned text. No Markdown parsing. */
export function parsePage(name: string, source: string): Page {
  const sections: Record<string, string> = {};
  let heading = "";
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    if (/^[A-Z][A-Z ]+$/.test(line)) {
      heading = line;
      sections[heading] = "";
    } else if (heading) sections[heading] += `${line}\n`;
  }
  for (const key of Object.keys(sections))
    sections[key] = sections[key]!.trimEnd();
  return { name, sections };
}

export async function readPage(name: string): Promise<Page> {
  return parsePage(name, await manualPage(name));
}

export function pageText(page: Page): string {
  return Object.entries(page.sections)
    .map(([heading, body]) => `${heading}\n${body}\n`)
    .join("\n");
}
export function shortHelp(page: Page): string {
  return (
    pageText({
      ...page,
      sections: Object.fromEntries(
        ["NAME", "SYNOPSIS", "OPTIONS", "EXAMPLES"].map((key) => [
          key,
          page.sections[key] ?? "",
        ]),
      ),
    }) +
    "\nGlobal options: ajour --help. Full manual: ajour help " +
    page.name +
    "\n"
  );
}

const GROUPS = {
  "Running entry": ["start", "stop", "discard", "continue", "status"],
  Entries: ["add", "edit", "move", "dup", "rm", "undo"],
  Reading: ["log", "projects"],
  Setup: ["connect", "completion", "help"],
};
export async function helpCard(): Promise<string> {
  const main = await readPage("ajour");
  let text = `${main.sections.NAME}\n\nUsage: ${main.sections.SYNOPSIS}\n`;
  for (const [group, names] of Object.entries(GROUPS)) {
    text += `\n${group}\n`;
    const pages = await Promise.all(names.map(readPage));
    const synopses = pages.map((page) =>
      page.sections
        .SYNOPSIS!.split("\n")[0]!
        .trim()
        .replace(/^ajour /, ""),
    );
    const width = Math.max(...synopses.map((synopsis) => synopsis.length));
    pages.forEach((page, index) => {
      text += `  ${padEnd(synopses[index]!, width)}  ${page.sections.NAME!.split(" - ").slice(1).join(" - ")}\n`;
    });
  }
  return `${text}\nOptions\n${main.sections.OPTIONS}\n\nRun 'ajour help <command>' or 'man ajour-<command>' for details.\n`;
}

/** Literal no-fill blocks preserve the page's alignment and escape roff requests. */
export function roff(name: string, source: string): string {
  const page = parsePage(name, source);
  const escape = (line: string) =>
    line
      .replaceAll("\\", "\\e")
      .replaceAll("-", "\\-")
      .replace(/^[.']/, "\\&$&");
  return (
    `.TH "${name === "ajour" ? "AJOUR" : `AJOUR-${name.toUpperCase()}`}" "1" "" "Ajour" "Ajour Manual"\n` +
    Object.entries(page.sections)
      .map(
        ([heading, body]) =>
          `.SH "${heading}"\n.nf\n${body.split("\n").map(escape).join("\n")}\n.fi\n`,
      )
      .join("")
  );
}
