import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BridgeToolCall,
  BridgeToolResult,
} from "../../../packages/shared/agent-tools.ts";
import {
  enableMcpWithClient,
  openFakeWindow,
  startTestApi,
} from "../../api/src/test-support/mcp-harness.ts";
import type { CliIo } from "./io.ts";
import { run } from "./main.ts";
import { grouped } from "./test-support/workday-week.ts";
import { listed, projects } from "./test-support/log-week.ts";

// Wednesday 4 November 2026, 14:44:07 local time: the fixture's today.
const NOW = new Date(2026, 10, 4, 14, 44, 7).getTime();
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A fake Ajour window that answers the read tools from the mockups' week. */
function window(call: BridgeToolCall): BridgeToolResult {
  if (call.tool === "list_time_entries") {
    const { from, to } = call.input as { from: string; to: string };
    return { requestId: call.requestId, ok: true, output: listed(from, to) };
  }
  if (call.tool === "list_projects") {
    return { requestId: call.requestId, ok: true, output: { projects } };
  }
  return {
    requestId: call.requestId,
    ok: false,
    error: `No fixture for ${call.tool}.`,
  };
}

interface Terminal {
  io: CliIo;
  out(): string;
  err(): string;
  calls: BridgeToolCall[];
}

/** A connected terminal, a pipe unless `tty`, against the real local API. */
async function ajour(
  options: {
    tty?: boolean;
    columns?: number;
    projects?: typeof projects;
    respond?: (call: BridgeToolCall) => BridgeToolResult;
  } = {},
) {
  const api = await startTestApi();
  cleanups.push(() => api.stop());
  const { token } = await enableMcpWithClient(api);
  const fake = await openFakeWindow(api, (call) =>
    call.tool === "list_projects" && options.projects
      ? {
          requestId: call.requestId,
          ok: true,
          output: { projects: options.projects },
        }
      : options.respond
        ? options.respond(call)
        : window(call),
  );
  cleanups.push(() => fake.close());
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-log-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  let out = "";
  let err = "";
  const terminal: Terminal = {
    calls: fake.calls,
    out: () => out,
    err: () => err,
    io: {
      stdout: {
        write: (text) => void (out += text),
        isTTY: options.tty ?? false,
        columns: options.columns ?? 120,
      },
      stderr: { write: (text) => void (err += text), isTTY: false },
      env: {
        AJOUR_URL: api.baseUrl,
        AJOUR_TOKEN: token,
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_STATE_HOME: path.join(home, "state"),
      },
      platform: process.platform,
      homedir: home,
      now: () => NOW,
      readSecret: async () => "",
      readStdin: async () => "",
      wait: async () => false,
      releaseInput: () => undefined,
    },
  };
  return terminal;
}

/** A CSV reader after RFC 4180: quoted fields, doubled quotes, line breaks. */
function readCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || record.length) records.push([...record, field]);
  return records;
}

describe("ajour log for tools", () => {
  it("prints TSV in a pipe, so cut -f3 gives the hours", async () => {
    const term = await ajour();

    expect(await run(["log", "week"], term.io)).toBe(0);

    const hours = term
      .out()
      .trimEnd()
      .split("\n")
      .map((line) => line.split("\t")[2]);
    expect(hours).toEqual([
      "hours",
      "3.00",
      "1.50",
      "3.50",
      "2.25",
      "3.00",
      "2.25",
      "1.40",
      "2.00",
      "0.75",
      "2.50",
    ]);
    expect(term.out()).not.toContain("\x1b");
    expect(term.err()).toBe("");
    expect(term.calls.map((call) => [call.tool, call.input])).toEqual([
      ["list_time_entries", { from: "2026-11-02", to: "2026-11-08" }],
    ]);
  });

  it("resolves a task within --project before checking ambiguity", async () => {
    const term = await ajour({
      projects: projects.map((project) => ({
        ...project,
        tasks:
          project.projectId === "p-acme"
            ? [...project.tasks, { taskId: "other-review", name: "04 Review" }]
            : project.tasks,
      })),
    });
    expect(
      await run(
        ["log", "week", "--project", "ajr", "--task", "review"],
        term.io,
      ),
    ).toBe(0);
    expect(term.out()).toContain("PR #512, #514");
    expect(term.out()).not.toContain("Rate limiter");
  });

  it.each([["--summary"], ["--by", "task"]])(
    "prints %j as a plain table in a pipe",
    async (...flags) => {
      const term = await ajour();
      expect(await run(["log", "week", ...flags], term.io)).toBe(0);
      expect(term.out()).toContain("Week 45");
      expect(term.out()).toContain(
        flags[0] === "--summary" ? "6:39" : "07 Export",
      );
      expect(term.out()).not.toContain("\x1b");
      expect(term.out()).not.toContain("\t");
    },
  );

  it("prints CSV with a header that a CSV reader parses", async () => {
    const term = await ajour();

    expect(await run(["log", "mon..wed", "--format", "csv"], term.io)).toBe(0);

    const [header, ...records] = readCsv(term.out());
    expect(header).toEqual([
      "date",
      "state",
      "hours",
      "project",
      "task",
      "note",
      "id",
    ]);
    expect(records).toHaveLength(10);
    expect(records).toContainEqual([
      "2026-11-04",
      "saved",
      "2.00",
      "AJR",
      "04 Review",
      "PR #512, #514",
      "b7e1d04",
    ]);
    expect(records).toContainEqual([
      "2026-11-04",
      "running",
      "1.40",
      "AJR",
      "07 Export",
      "Fix export rounding",
      "3f9a2c1",
    ]);
  });

  it("prints the tool's output with --json, filtered", async () => {
    const term = await ajour();

    expect(await run(["log", "week", "--uncommitted", "--json"], term.io)).toBe(
      0,
    );

    const output = JSON.parse(term.out()) as ReturnType<typeof listed>;
    expect(output.entries.map((entry) => entry.note)).toEqual([
      "Schema dry run on the staging copy",
      "PR #510",
      "PR #512, #514",
    ]);
    expect(output.running?.note).toBe("Fix export rounding");
    expect(output.targets).toHaveLength(7);
  });

  it("filters by project and task, as a TASK matches", async () => {
    const term = await ajour();

    expect(
      await run(["log", "week", "--project", "acme", "--committed"], term.io),
    ).toBe(0);
    expect(
      term
        .out()
        .trimEnd()
        .split("\n")
        .slice(1)
        .map((line) => line.split("\t").slice(0, 5).join(" ")),
    ).toEqual([
      "2026-11-02 committed 3.50 ACME 05 Backend",
      "2026-11-03 committed 2.25 ACME 03 Meetings",
      "2026-11-04 committed 0.75 ACME 03 Meetings",
      "2026-11-04 committed 2.50 ACME 05 Backend",
    ]);

    const byTask = await ajour();
    expect(await run(["log", "week", "--task", "ajr/export"], byTask.io)).toBe(
      0,
    );
    expect(byTask.out().trimEnd().split("\n").slice(1)).toEqual([
      "2026-11-02\tcommitted\t3.00\tAJR\t07 Export\tFix export rounding\t2a9e1f0",
      "2026-11-04\trunning\t1.40\tAJR\t07 Export\tFix export rounding\t3f9a2c1",
    ]);
  });
});

describe("ajour log on a terminal", () => {
  it("prints today's table, colored", async () => {
    const term = await ajour({ tty: true, columns: 120 });

    expect(await run(["log"], term.io)).toBe(0);

    const lines = term.out().split("\n");
    expect(lines[0]).toBe(
      "\x1b[1;34mWednesday 4 November 2026\x1b[0m\x1b[90m · today\x1b[0m" +
        "   \x1b[1m6:39\x1b[0m\x1b[90m of 8:00\x1b[0m  " +
        "\x1b[1;34m▮▮▮▮▮▮▮▮\x1b[0m\x1b[90m▯▯\x1b[0m",
    );
    expect(term.out()).toContain("4 entries · 1 running · 2 committed");
  });

  it("prints the week with --format table in a pipe, plain", async () => {
    const term = await ajour();

    expect(await run(["log", "week", "--format", "table"], term.io)).toBe(0);

    expect(term.out()).toMatch(/^Week 45 · Mon 2 – Sun 8 Nov 2026 +22:09/);
    expect(term.out()).not.toContain("\x1b");
  });

  it("prints totals per day with --summary, and per task with --by task", async () => {
    const summary = await ajour({ tty: true });
    expect(
      await run(["log", "mon..wed", "-s", "--color", "never"], summary.io),
    ).toBe(0);
    expect(summary.out()).toContain("Wed 4   6:39  ▮▮▮▮▮▮▮▯  ● running\n");

    const byTask = await ajour({ tty: true });
    expect(
      await run(["log", "week", "--by", "task", "--color", "never"], byTask.io),
    ).toBe(0);
    expect(byTask.out()).toContain("   4:24  AJR   07 Export");
  });
});

describe("ajour log refusals", () => {
  it.each<[readonly string[], RegExp]>([
    [["log", "nope"], /isn't a range/],
    [["log", "2026-01-01..2026-06-30"], /at most 62 days/],
    [["log", "--committed", "--uncommitted"], /not both/],
    [["log", "--summary", "--by", "task"], /not both/],
    [["log", "--by", "week"], /--by takes day or task/],
    [["log", "--format", "xml"], /--format takes/],
  ])("refuses %j with exit 2 before asking Ajour", async (argv, message) => {
    const term = await ajour();

    expect(await run(argv, term.io)).toBe(2);

    expect(term.err()).toMatch(message);
    expect(term.calls).toEqual([]);
  });

  it.each(["tsv", "csv", "json"])(
    "refuses explicit %s for both summary views",
    async (format) => {
      for (const flags of [["--summary"], ["--by", "task"]]) {
        const term = await ajour();
        expect(await run(["log", ...flags, "--format", format], term.io)).toBe(
          2,
        );
        expect(term.err()).toContain("prints a table");
        expect(term.calls).toEqual([]);
      }
    },
  );

  it("exits 4 when --project matches nothing", async () => {
    const term = await ajour();

    expect(await run(["log", "--project", "zzz"], term.io)).toBe(4);

    expect(term.err()).toContain('No active project matches "zzz".');
  });
});

describe("the log manual", () => {
  it("shows the log page with --help, and the card lists it", async () => {
    const term = await ajour();
    expect(await run(["log", "--help"], term.io)).toBe(0);
    expect(term.out()).toMatch(/^NAME\najour log - /);
    expect(term.out()).toContain("--format workday");

    const card = await ajour();
    expect(await run(["--help"], card.io)).toBe(0);
    for (const line of ["log [RANGE] [-s] [--by task] [--format FORMAT]"]) {
      expect(card.out()).toContain(line);
    }
  });
});

describe("Workday through the MCP endpoint", () => {
  it("requests only the selected days in each touched week before printing task totals", async () => {
    const term = await ajour({
      respond: (call) => ({
        requestId: call.requestId,
        ok: true,
        output: {
          weekOf: (call.input as { weekOf: string }).weekOf,
          groupBy: "task",
          locked: false,
          sections: [
            {
              lines: [
                {
                  projectName: "Acme Platform",
                  taskName: "05 Backend",
                  hours: 1.5,
                  comments: "Selected days",
                  entryIds: ["1"],
                },
              ],
            },
          ],
          notSent: { hours: 0, items: [] },
          waiting: { hours: 0, tasks: [] },
          running: null,
        },
      }),
    });
    expect(
      await run(
        [
          "log",
          "2026-11-06..2026-11-10",
          "--format",
          "workday",
          "--by",
          "task",
        ],
        term.io,
      ),
    ).toBe(0);
    expect(term.calls.map((call) => [call.tool, call.input])).toEqual([
      [
        "get_week_lines",
        {
          weekOf: "2026-11-02",
          groupBy: "task",
          from: "2026-11-06",
          to: "2026-11-08",
        },
      ],
      [
        "get_week_lines",
        {
          weekOf: "2026-11-09",
          groupBy: "task",
          from: "2026-11-09",
          to: "2026-11-10",
        },
      ],
    ]);
    expect(term.out()).toBe(
      "Acme Platform\t05 Backend\t1,50\tSelected days\nAcme Platform\t05 Backend\t1,50\tSelected days\n",
    );
  });
  it("prints no partial clipboard output when a later week's plugin names are unavailable", async () => {
    const term = await ajour({
      respond: (call) =>
        (call.input as { weekOf: string }).weekOf === "2026-11-02"
          ? { requestId: call.requestId, ok: true, output: grouped("day-task") }
          : {
              requestId: call.requestId,
              ok: false,
              error: "Ajour couldn't read the plugins' task names. Try again.",
            },
    });
    expect(
      await run(
        ["log", "2026-11-02..2026-11-10", "--format", "workday"],
        term.io,
      ),
    ).toBe(1);
    expect(term.out()).toBe("");
    expect(term.err()).toBe(
      "refused: Ajour couldn't read the plugins' task names. Try again.\n",
    );
  });
});

for (const by of ["day-task", "day", "task"] as const) {
  for (const tty of [true, false]) {
    it(`prints the ${by} mockup through MCP on ${tty ? "TTY" : "pipe"}`, async () => {
      const term = await ajour({
        tty,
        respond: (call) => ({
          requestId: call.requestId,
          ok: true,
          output: grouped(by),
        }),
      });
      expect(
        await run(
          [
            "--color",
            "never",
            "log",
            "week",
            "--format",
            "workday",
            "--by",
            by,
          ],
          term.io,
        ),
      ).toBe(0);
      await expect(term.out()).toMatchFileSnapshot(
        `format/golden/workday-${by}-${tty ? "tty" : "pipe"}.txt`,
      );
      expect(term.calls).toHaveLength(1);
      expect(term.calls[0]?.tool).toBe("get_week_lines");
    });
  }
}

it("refuses unsupported Workday options before dialing Ajour", async () => {
  for (const args of [
    ["--by", "week"],
    ["--summary"],
    ["--project", "ACME"],
    ["--task", "Build"],
    ["--committed"],
    ["--uncommitted"],
    ["--json"],
  ]) {
    const term = await ajour();
    expect(await run(["log", "--format", "workday", ...args], term.io)).toBe(2);
    expect(term.calls).toHaveLength(0);
    expect(term.out()).toBe("");
  }
});
