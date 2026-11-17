import { describe, expect, it } from "vitest";
import { parseReleaseChanges, releaseLabel } from "@/domain/release-notes";

const pull = (number: number) =>
  `https://github.com/les-cabochons/ajour/pull/${number}`;

describe("parseReleaseChanges", () => {
  it("reads GitHub's generated notes as one change per pull request", () => {
    const body = [
      "## What's Changed",
      `* fix(backlog): narrow comments have no timeline by @alextrepa in ${pull(668)}`,
      `* feat(plugins): apply command modes to undeclared processes by @alextrepa in ${pull(738)}`,
      "",
      "",
      "**Full Changelog**: https://github.com/les-cabochons/ajour/compare/v0.0.1-nightly.20261116.374...v0.0.1-nightly.20261116.376",
    ].join("\n");

    expect(parseReleaseChanges(body)).toEqual([
      {
        kind: "fix",
        area: "Backlog",
        summary: "Narrow comments have no timeline",
        pullNumber: 668,
        pullUrl: pull(668),
      },
      {
        kind: "new",
        area: "Plugins",
        summary: "Apply command modes to undeclared processes",
        pullNumber: 738,
        pullUrl: pull(738),
      },
    ]);
  });

  it("names performance work as improved and leaves out work users never see", () => {
    const body = [
      `* perf(time): the week view renders once per tick by @a in ${pull(1)}`,
      `* docs: add privacy policy by @a in ${pull(2)}`,
      `* test(api): the agent runner tests pass on Windows by @a in ${pull(3)}`,
      `* chore(deps): bump vite by @a in ${pull(4)}`,
      `* refactor(store): split the reducer by @a in ${pull(5)}`,
      `* ci: cache pnpm by @a in ${pull(6)}`,
    ].join("\n");

    expect(parseReleaseChanges(body)).toEqual([
      expect.objectContaining({
        kind: "improved",
        area: "Time",
        summary: "The week view renders once per tick",
      }),
    ]);
  });

  it("keeps a title that follows no convention as a plain change", () => {
    expect(
      parseReleaseChanges(`* Release the timer panel by @a in ${pull(9)}`),
    ).toEqual([
      {
        kind: "change",
        area: null,
        summary: "Release the timer panel",
        pullNumber: 9,
        pullUrl: pull(9),
      },
    ]);
  });

  it("spells areas the way the app does", () => {
    const areas = parseReleaseChanges(
      [
        `* feat(plugin-api): a time sync capability by @a in ${pull(1)}`,
        `* fix(mcp): tools list again by @a in ${pull(2)}`,
        `* feat(cli,wsl): install in WSL by @a in ${pull(3)}`,
      ].join("\n"),
    ).map((change) => change.area);

    expect(areas).toEqual(["Plugin API", "MCP", "CLI, WSL"]);
  });

  it("links only this repository's pull requests", () => {
    const [change] = parseReleaseChanges(
      "* feat(time): log time by @a in https://evil.example/les-cabochons/ajour/pull/5",
    );

    expect(change).toEqual(
      expect.objectContaining({ pullNumber: null, pullUrl: null }),
    );
    expect(change?.summary).toBe(
      "Log time by @a in https://evil.example/les-cabochons/ajour/pull/5",
    );
  });

  it("skips promotion notes, contributor lists and the changelog link", () => {
    const body = [
      "Promoted from v0.0.1-nightly.20261105.326.",
      "## What's Changed",
      `* feat(projects): complete means archived everywhere by @alextrepa in ${pull(646)}`,
      "## New Contributors",
      `* @someone made their first contribution in ${pull(700)}`,
      "**Full Changelog**: https://github.com/les-cabochons/ajour/compare/a...b",
    ].join("\n");

    expect(
      parseReleaseChanges(body).map((change) => change.pullNumber),
    ).toEqual([646]);
  });

  it("reads a breaking change and a trailing pull request number", () => {
    expect(
      parseReleaseChanges("- feat(plugins)!: cut over to plugin API 4 (#613)"),
    ).toEqual([
      {
        kind: "new",
        area: "Plugins",
        summary: "Cut over to plugin API 4",
        pullNumber: 613,
        pullUrl: pull(613),
      },
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(parseReleaseChanges("")).toEqual([]);
  });
});

describe("releaseLabel", () => {
  it("names a nightly build by its build number", () => {
    expect(releaseLabel("0.0.1-nightly.20261116.377")).toBe("Nightly 377");
    expect(releaseLabel("0.0.1-nightly-20261020-042")).toBe("Nightly 42");
  });

  it("keeps a stable version as it is", () => {
    expect(releaseLabel("1.4.0")).toBe("1.4.0");
  });
});
