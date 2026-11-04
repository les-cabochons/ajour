import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRunningTimer,
  AgentTimeEntry,
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

// Wednesday 4 November 2026, 14:44:07 local time.
const NOW = new Date(2026, 10, 4, 14, 44, 7).getTime();
const TODAY = "2026-11-04";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** 32 hex characters starting with `start`, as an entry's short id. */
function hexId(start: string) {
  return start.padEnd(32, "0");
}

const projects = {
  projects: [
    {
      projectId: "p-acme",
      name: "Acme Platform",
      code: "ACME",
      tasks: [
        { taskId: "t-meet", name: "03 Meetings", pinnedSlot: 1 },
        { taskId: "t-backend", name: "05 Backend" },
        { taskId: "t-code-review", name: "08 Code review" },
      ],
    },
    {
      projectId: "p-ajr",
      name: "Ajour Desktop",
      code: "AJR",
      tasks: [
        { taskId: "t-review", name: "04 Review" },
        { taskId: "t-export", name: "07 Export" },
      ],
    },
  ],
};

const exportRunning: AgentRunningTimer = {
  timerId: "timer_1",
  shortId: hexId("3f9a2c1"),
  date: TODAY,
  countedMinutes: 20,
  projectId: "p-ajr",
  projectCode: "AJR",
  projectName: "Ajour Desktop",
  taskId: "t-export",
  taskName: "07 Export",
  note: "Fix export rounding",
};

const exportSaved: AgentTimeEntry = {
  entryId: "timesheet_3f9a2c1",
  shortId: hexId("3f9a2c1"),
  date: TODAY,
  state: "saved",
  minutes: 91,
  savedAt: new Date(NOW - 60_000).toISOString(),
  projectId: "p-ajr",
  projectCode: "AJR",
  projectName: "Ajour Desktop",
  taskId: "t-export",
  taskName: "07 Export",
  note: "Fix export rounding",
};

type Answer = object | { refuse: string };
/** Each handler types the input it reads, as the tool's schema says. */
type Handlers = Partial<Record<string, (input: never) => Answer>>;

/** A fake Ajour window that answers each tool from the test's handlers. */
function scripted(handlers: Handlers) {
  return (call: BridgeToolCall): BridgeToolResult => {
    const handler = handlers[call.tool];
    if (!handler) {
      return {
        requestId: call.requestId,
        ok: false,
        error: `No fixture for ${call.tool}.`,
      };
    }
    const answer = handler(call.input as never);
    return "refuse" in answer
      ? { requestId: call.requestId, ok: false, error: answer.refuse }
      : { requestId: call.requestId, ok: true, output: answer };
  };
}

interface Terminal {
  io: CliIo;
  out(): string;
  err(): string;
  /** Clears what was printed, between commands. */
  clear(): void;
  calls: BridgeToolCall[];
  home: string;
}

/** A connected terminal against the real local API and a scripted window. */
async function ajour(handlers: Handlers): Promise<Terminal> {
  const api = await startTestApi();
  cleanups.push(() => api.stop());
  const { token } = await enableMcpWithClient(api);
  const fake = await openFakeWindow(api, scripted(handlers));
  cleanups.push(() => fake.close());
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-running-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  let out = "";
  let err = "";
  return {
    home,
    calls: fake.calls,
    out: () => out,
    err: () => err,
    clear: () => {
      out = "";
      err = "";
    },
    io: {
      stdout: {
        write: (text) => void (out += text),
        isTTY: false,
        columns: 120,
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
}

/** The write tools the CLI called, with their inputs. */
function writes(term: Terminal) {
  return term.calls
    .filter((call) => !/^(list_|get_|find_)/.test(call.tool))
    .map((call) => ({ tool: call.tool, input: call.input }));
}

function undoFile(term: Terminal) {
  return path.join(term.home, "state", "ajour", "last-undo");
}

describe("ajour start", () => {
  it("starts an entry on a task, counting on from -d, and prints its row", async () => {
    const term = await ajour({
      list_projects: () => projects,
      start_timer: () => ({ running: exportRunning, undoToken: "undo_1" }),
    });

    const code = await run(
      ["start", "ajr/export", "-d", "0:20", "-m", "Fix export rounding"],
      term.io,
    );

    expect(code).toBe(0);
    expect(term.out()).toBe(
      "●  0:20  AJR  07 Export  Fix export rounding  3f9a2c1\n",
    );
    expect(term.err()).toBe("");
    expect(writes(term)).toEqual([
      {
        tool: "start_timer",
        input: {
          projectId: "p-ajr",
          taskId: "t-export",
          note: "Fix export rounding",
          countedMinutes: 20,
        },
      },
    ]);
    expect((await readFile(undoFile(term), "utf8")).trim()).toBe("undo_1");
    if (process.platform !== "win32") {
      expect((await stat(undoFile(term))).mode & 0o777).toBe(0o600);
    }
  });

  it("switches without a prompt: the saved row, then the new one, from a pinned key", async () => {
    const term = await ajour({
      list_projects: () => projects,
      start_timer: () => ({
        running: {
          timerId: "timer_2",
          shortId: hexId("91c0aa3"),
          date: TODAY,
          countedMinutes: 0,
          projectCode: "ACME",
          taskName: "03 Meetings",
          note: "Weekly sync",
        },
        saved: { ...exportSaved, minutes: 88 },
        undoToken: "undo_2",
      }),
    });

    expect(await run(["start", "1", "-m", "Weekly sync"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "   1:28  AJR   07 Export    Fix export rounding  3f9a2c1  saved\n" +
        "●  0:00  ACME  03 Meetings  Weekly sync          91c0aa3\n",
    );
    expect(writes(term)[0]!.input).toEqual({
      projectId: "p-acme",
      taskId: "t-meet",
      note: "Weekly sync",
    });
  });

  it("starts an empty entry without a task, and says how to set one", async () => {
    const term = await ajour({
      start_timer: () => ({
        running: {
          timerId: "timer_3",
          shortId: hexId("7a20b1c"),
          date: TODAY,
          countedMinutes: 0,
        },
        undoToken: "undo_3",
      }),
    });

    expect(await run(["start"], term.io)).toBe(0);

    expect(term.out()).toBe("●  0:00  —  —  Untitled entry  7a20b1c\n");
    expect(term.err()).toBe("Set its task with: ajour edit running TASK\n");
    expect(writes(term)).toEqual([{ tool: "start_timer", input: {} }]);
  });

  it("exits 4 with both candidates when a task is ambiguous, and starts nothing", async () => {
    const term = await ajour({ list_projects: () => projects });

    expect(await run(["start", "review"], term.io)).toBe(4);

    expect(term.err()).toBe(
      'error: "review" matches 2 tasks:\n' +
        "  ACME/08 Code review\n" +
        "  AJR/04 Review\n" +
        'Say which, such as: ajour start "AJR/04 Review"\n',
    );
    expect(writes(term)).toEqual([]);
  });

  it("prints the app's refusal and exits 1", async () => {
    const term = await ajour({
      list_projects: () => projects,
      start_timer: () => ({
        refuse:
          "Week 45 is submitted. Reopen it in Ajour to change its entries.",
      }),
    });

    expect(await run(["start", "export"], term.io)).toBe(1);

    expect(term.out()).toBe("");
    expect(term.err()).toBe(
      "refused: Week 45 is submitted. Reopen it in Ajour to change its entries.\n",
    );
    await expect(stat(undoFile(term))).rejects.toThrow();
  });

  it("refuses a bad duration with exit 2 before asking Ajour", async () => {
    const term = await ajour({});

    expect(await run(["start", "export", "-d", "25h"], term.io)).toBe(2);

    expect(term.err()).toMatch(/^usage: --duration takes a time/);
    expect(term.calls).toEqual([]);
  });

  it("prints the tool's output with --json", async () => {
    const term = await ajour({
      start_timer: () => ({ running: exportRunning, undoToken: "undo_1" }),
    });

    expect(await run(["start", "--json"], term.io)).toBe(0);

    expect(JSON.parse(term.out())).toEqual({
      running: exportRunning,
      undoToken: "undo_1",
    });
  });
});

describe("ajour stop", () => {
  it("prints the saved row and today's total against its target", async () => {
    const term = await ajour({
      stop_timer: () => ({
        stopped: true,
        countedMinutes: 91,
        entry: exportSaved,
        undoToken: "undo_4",
      }),
      list_time_entries: () => ({
        entries: [
          exportSaved,
          {
            ...exportSaved,
            entryId: "e2",
            shortId: hexId("aa"),
            minutes: 315,
          },
        ],
        running: null,
        targets: [{ date: TODAY, hours: 8 }],
      }),
    });

    expect(await run(["stop"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "   1:31  AJR  07 Export  Fix export rounding  3f9a2c1  saved\n",
    );
    expect(term.err()).toBe("Today 6:46 of 8:00\n");
    expect(
      term.calls.find((call) => call.tool === "list_time_entries")?.input,
    ).toEqual({ from: TODAY, to: TODAY });
  });

  it("exits 1 with the app's reason when nothing runs", async () => {
    const term = await ajour({
      stop_timer: () => ({ refuse: "No entry is running." }),
    });

    expect(await run(["stop"], term.io)).toBe(1);

    expect(term.err()).toBe("refused: No entry is running.\n");
  });
});

describe("ajour continue", () => {
  it("resumes the entry saved last, today, with its saved time", async () => {
    const older = {
      ...exportSaved,
      entryId: "timesheet_old",
      shortId: hexId("0d4f77e"),
      savedAt: new Date(NOW - 3_600_000).toISOString(),
    };
    const term = await ajour({
      list_time_entries: () => ({
        entries: [exportSaved, older],
        running: null,
      }),
      continue_entry: () => ({
        running: { ...exportRunning, countedMinutes: 91 },
        undoToken: "undo_5",
      }),
    });

    expect(await run(["continue"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "●  1:31  AJR  07 Export  Fix export rounding  3f9a2c1\n",
    );
    expect(term.err()).toBe("");
    expect(writes(term)).toEqual([
      { tool: "continue_entry", input: { entryId: "timesheet_3f9a2c1" } },
    ]);
    expect(
      term.calls.find((call) => call.tool === "list_time_entries")?.input,
    ).toEqual({ from: "2026-10-29", to: TODAY });
  });

  it("starts a new entry today from another day's entry, and says so", async () => {
    const monday: AgentTimeEntry = {
      ...exportSaved,
      entryId: "timesheet_0d4f77e",
      shortId: hexId("0d4f77e"),
      date: "2026-11-02",
      projectCode: "ACME",
      taskName: "05 Backend",
      note: "Rate limiter retries",
    };
    const term = await ajour({
      find_entries: () => ({ entries: [monday], running: null }),
      continue_entry: () => ({
        running: {
          ...exportRunning,
          shortId: hexId("e91c4b7"),
          countedMinutes: 0,
          projectCode: "ACME",
          taskName: "05 Backend",
          note: "Rate limiter retries",
        },
        undoToken: "undo_6",
      }),
    });

    expect(await run(["continue", "0d4f77e"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "●  0:00  ACME  05 Backend  Rate limiter retries  e91c4b7\n",
    );
    expect(term.err()).toBe(
      "Started a new entry today with Monday's task and note.\n",
    );
    expect(term.calls[0]).toMatchObject({
      tool: "find_entries",
      input: { idPrefix: "0d4f77e" },
    });
    expect(writes(term)).toEqual([
      { tool: "continue_entry", input: { entryId: "timesheet_0d4f77e" } },
    ]);
  });

  it("exits 4 with the candidate rows when a prefix finds several entries", async () => {
    const term = await ajour({
      find_entries: () => ({
        entries: [
          { ...exportSaved, shortId: hexId("3f9a2c1a") },
          {
            ...exportSaved,
            entryId: "e9",
            shortId: hexId("3f9a2c1b"),
            date: "2026-11-03",
            minutes: 45,
            taskName: "04 Review",
            note: "PR #512",
          },
        ],
        running: null,
      }),
    });

    expect(await run(["continue", "3f9a"], term.io)).toBe(4);

    expect(term.err()).toBe(
      'error: "3f9a" matches 2 entries:\n' +
        "     1:31  AJR  07 Export  Fix export rounding  3f9a2c1a\n" +
        "     0:45  AJR  04 Review  PR #512              3f9a2c1b  Tue 3 Nov\n" +
        "Say which with more of its id.\n",
    );
    expect(writes(term)).toEqual([]);
  });
});

describe("ajour edit running", () => {
  it("changes the running entry's task and note, and it keeps running", async () => {
    const term = await ajour({
      list_projects: () => projects,
      edit_running_entry: () => ({
        running: {
          ...exportRunning,
          countedMinutes: 84,
          taskId: "t-review",
          taskName: "04 Review",
          note: "PR #512, #514",
        },
        undoToken: "undo_7",
      }),
    });

    expect(
      await run(
        ["edit", "running", "ajr/review", "-m", "PR #512, #514"],
        term.io,
      ),
    ).toBe(0);

    expect(term.out()).toBe(
      "●  1:24  AJR  04 Review  PR #512, #514  3f9a2c1\n",
    );
    expect(writes(term)).toEqual([
      {
        tool: "edit_running_entry",
        input: {
          projectId: "p-ajr",
          taskId: "t-review",
          note: "PR #512, #514",
        },
      },
    ]);
  });

  it("corrects the counted time with -d, zero included", async () => {
    const term = await ajour({
      edit_running_entry: (input: { countedMinutes: number }) => ({
        running: { ...exportRunning, countedMinutes: input.countedMinutes },
        undoToken: "undo_8",
      }),
    });

    expect(await run(["edit", "running", "-d", "1:00"], term.io)).toBe(0);
    expect(await run(["edit", "running", "-d", "0"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "●  1:00  AJR  07 Export  Fix export rounding  3f9a2c1\n" +
        "●  0:00  AJR  07 Export  Fix export rounding  3f9a2c1\n",
    );
    expect(writes(term).map((write) => write.input)).toEqual([
      { countedMinutes: 60 },
      { countedMinutes: 0 },
    ]);
  });

  it("refuses an edit that changes nothing, or an entry other than the running one, with exit 2", async () => {
    const term = await ajour({});

    expect(await run(["edit", "running"], term.io)).toBe(2);
    expect(await run(["edit"], term.io)).toBe(2);
    expect(await run(["edit", "b7e1d04", "-d", "1:00"], term.io)).toBe(2);

    expect(term.err()).toBe(
      "usage: Say what to change: a TASK, -m NOTE or -d DURATION.\n" +
        "usage: edit takes an ENTRY, such as: ajour edit running TASK\n" +
        "usage: Only the running entry can be edited from the terminal yet: ajour edit running\n",
    );
    expect(term.calls).toEqual([]);
  });
});

describe("ajour discard and undo", () => {
  it("discards the running entry, says what it threw away, and undo brings it back", async () => {
    let undone = false;
    const term = await ajour({
      get_running_timer: () => ({
        running: { ...exportRunning, countedMinutes: 4 },
      }),
      discard_timer: () => ({ discardedMinutes: 4, undoToken: "undo_9" }),
      undo: (input: { undoToken: string }) => {
        undone = input.undoToken === "undo_9";
        return { undone: "Discarded the running entry", undoToken: null };
      },
    });

    expect(await run(["discard"], term.io)).toBe(0);
    expect(term.out()).toBe("");
    expect(term.err()).toBe(
      "Discarded 0:04 on 07 Export. Undo with: ajour undo\n",
    );
    term.clear();

    expect(await run(["undo"], term.io)).toBe(0);
    expect(undone).toBe(true);
    expect(term.err()).toBe("Undid: Discarded the running entry\n");
    await expect(stat(undoFile(term))).rejects.toThrow();
    term.clear();

    expect(await run(["undo"], term.io)).toBe(1);
    expect(term.err()).toBe("Nothing to undo from here.\n");
    expect(writes(term).map((write) => write.tool)).toEqual([
      "discard_timer",
      "undo",
    ]);
  });

  it("forgets a token Ajour no longer takes, with its reason", async () => {
    const term = await ajour({
      start_timer: () => ({ running: exportRunning, undoToken: "undo_1" }),
      undo: () => ({ refuse: "That change can't be undone any more." }),
    });
    await run(["start"], term.io);
    term.clear();

    expect(await run(["undo"], term.io)).toBe(1);
    expect(term.err()).toBe("refused: That change can't be undone any more.\n");
    await expect(stat(undoFile(term))).rejects.toThrow();
  });

  it("refuses a discard with nothing running with the app's reason", async () => {
    const term = await ajour({
      get_running_timer: () => ({ running: null }),
      discard_timer: () => ({ refuse: "Nothing is running" }),
    });

    expect(await run(["discard"], term.io)).toBe(1);
    expect(term.err()).toBe("refused: Nothing is running\n");
  });
});

describe("a day from the terminal", () => {
  it("runs start, switch, stop, continue, edit, discard and undo against a stand-in for Ajour", async () => {
    // One running entry and the saved entries, as small as the CLI needs.
    let running: AgentRunningTimer | null = null;
    const saved: AgentTimeEntry[] = [];
    let next = 0;
    const save = () => {
      const current = running;
      if (!current) return undefined;
      const entry: AgentTimeEntry = {
        entryId: `timesheet_${current.shortId}`,
        shortId: current.shortId,
        date: current.date,
        state: "saved",
        minutes: current.countedMinutes,
        savedAt: new Date(NOW + next * 1000).toISOString(),
        ...(current.projectCode ? { projectCode: current.projectCode } : {}),
        ...(current.taskName ? { taskName: current.taskName } : {}),
        ...(current.note ? { note: current.note } : {}),
      };
      const index = saved.findIndex((item) => item.entryId === entry.entryId);
      if (index >= 0) saved.splice(index, 1);
      saved.push(entry);
      running = null;
      return entry;
    };
    const token = () => `undo_${next}`;
    const term = await ajour({
      list_projects: () => projects,
      start_timer: (input: { taskId?: string; note?: string }) => {
        const before = save();
        const meetings = input.taskId === "t-meet";
        next += 1;
        running = {
          timerId: `timer_${next}`,
          shortId: hexId(`${next}abc`),
          date: TODAY,
          countedMinutes: 30,
          projectCode: meetings ? "ACME" : "AJR",
          taskName: meetings ? "03 Meetings" : "07 Export",
          ...(input.note ? { note: input.note } : {}),
        };
        return {
          running,
          ...(before ? { saved: before } : {}),
          undoToken: token(),
        };
      },
      stop_timer: () => {
        const entry = save();
        return entry
          ? {
              stopped: true,
              countedMinutes: entry.minutes,
              entry,
              undoToken: token(),
            }
          : { refuse: "No entry is running." };
      },
      list_time_entries: () => ({
        entries: saved,
        running,
        targets: [{ date: TODAY, hours: 8 }],
      }),
      continue_entry: (input: { entryId: string }) => {
        const entry = saved.find((item) => item.entryId === input.entryId)!;
        next += 1;
        running = {
          timerId: `timer_${next}`,
          shortId: entry.shortId,
          date: TODAY,
          countedMinutes: entry.minutes,
          ...(entry.projectCode ? { projectCode: entry.projectCode } : {}),
          ...(entry.taskName ? { taskName: entry.taskName } : {}),
          ...(entry.note ? { note: entry.note } : {}),
        };
        return { running, undoToken: token() };
      },
      edit_running_entry: (input: { note?: string }) => {
        running = { ...running!, note: input.note };
        return { running, undoToken: token() };
      },
      get_running_timer: () => ({ running }),
      discard_timer: () => {
        const minutes = running!.countedMinutes;
        running = null;
        return { discardedMinutes: minutes, undoToken: "undo_discard" };
      },
      undo: (input: { undoToken: string }) =>
        input.undoToken === "undo_discard"
          ? { undone: "Discarded the running entry", undoToken: null }
          : { refuse: "That change can't be undone any more." },
    });
    const step = async (args: string[]) => {
      term.clear();
      const code = await run(args, term.io);
      return { code, out: term.out(), err: term.err() };
    };

    expect(await step(["start", "export", "-m", "Rounding"])).toEqual({
      code: 0,
      out: "●  0:30  AJR  07 Export  Rounding  1abc000\n",
      err: "",
    });
    expect(await step(["start", "1"])).toEqual({
      code: 0,
      out:
        "   0:30  AJR   07 Export    Rounding  1abc000  saved\n" +
        "●  0:30  ACME  03 Meetings            2abc000\n",
      err: "",
    });
    expect(await step(["stop"])).toEqual({
      code: 0,
      out: "   0:30  ACME  03 Meetings  2abc000  saved\n",
      err: "Today 1:00 of 8:00\n",
    });
    expect(await step(["continue", "last"])).toEqual({
      code: 0,
      out: "●  0:30  ACME  03 Meetings  2abc000\n",
      err: "",
    });
    expect(await step(["edit", "running", "-m", "Planning"])).toEqual({
      code: 0,
      out: "●  0:30  ACME  03 Meetings  Planning  2abc000\n",
      err: "",
    });
    expect(await step(["discard"])).toEqual({
      code: 0,
      out: "",
      err: "Discarded 0:30 on 03 Meetings. Undo with: ajour undo\n",
    });
    expect(await step(["undo"])).toEqual({
      code: 0,
      out: "",
      err: "Undid: Discarded the running entry\n",
    });
    expect(await step(["stop"])).toEqual({
      code: 1,
      out: "",
      err: "refused: No entry is running.\n",
    });
  });
});

describe("the manual", () => {
  it.each(["start", "stop", "continue", "edit", "discard", "undo"])(
    "shows the %s page with --help",
    async (name) => {
      const term = await ajour({});
      expect(await run([name, "--help"], term.io)).toBe(0);
      expect(term.out()).toMatch(new RegExp(`^ajour ${name} — `));
    },
  );

  it("lists the commands and the references on the card", async () => {
    const term = await ajour({});
    expect(await run(["--help"], term.io)).toBe(0);
    for (const line of [
      "start [TASK] [-m NOTE] [-d DURATION]",
      "continue [ENTRY]",
      "edit running [TASK] [-m NOTE] [-d DURATION]",
      "References",
      "4  A reference matched nothing or several things.",
    ]) {
      expect(term.out()).toContain(line);
    }
  });
});
