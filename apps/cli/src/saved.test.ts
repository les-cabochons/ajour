import { readFile, stat } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../packages/shared/agent-tools.ts";
import { run } from "./main.ts";
import {
  ajour,
  closeTerminals,
  hexId,
  NOW,
  projects,
  TODAY,
  undoFile,
  writes,
  type Terminal,
} from "./test-support/terminal.ts";

afterEach(closeTerminals);

const YESTERDAY = "2026-11-03";

const review: AgentTimeEntry = {
  entryId: "timesheet_b7e1d04",
  shortId: hexId("b7e1d04"),
  date: YESTERDAY,
  state: "saved",
  minutes: 45,
  savedAt: new Date(NOW - 3_600_000).toISOString(),
  projectId: "p-ajr",
  projectCode: "AJR",
  projectName: "Ajour Desktop",
  taskId: "t-review",
  taskName: "04 Review",
  note: "PR #512",
};

const sync: AgentTimeEntry = {
  entryId: "timesheet_91c0aa3",
  shortId: hexId("91c0aa3"),
  date: TODAY,
  state: "committed",
  minutes: 45,
  savedAt: new Date(NOW - 7_200_000).toISOString(),
  projectId: "p-acme",
  projectCode: "ACME",
  projectName: "Acme Platform",
  taskId: "t-meet",
  taskName: "03 Meetings",
  note: "Weekly sync",
};

const running: AgentRunningTimer = {
  timerId: "timer_1",
  shortId: hexId("3f9a2c1"),
  date: TODAY,
  countedMinutes: 84,
  projectId: "p-ajr",
  projectCode: "AJR",
  projectName: "Ajour Desktop",
  taskId: "t-export",
  taskName: "07 Export",
  note: "Fix export rounding",
};

const LOCKED = "The week of Oct 12 is submitted. Reopen it to change it.";

/** find_entries over a fixed list and the running entry. */
function finder(entries: readonly AgentTimeEntry[], timer = running) {
  return (input: { idPrefix: string }) => ({
    entries: entries.filter((entry) =>
      entry.shortId?.startsWith(input.idPrefix),
    ),
    running: timer.shortId?.startsWith(input.idPrefix) ? timer : null,
  });
}

async function kept(term: Terminal) {
  return (await readFile(undoFile(term), "utf8")).trim();
}

describe("ajour add", () => {
  it("saves an entry on another day without running it, and prints its row with the day", async () => {
    const term = await ajour({
      list_projects: () => projects,
      create_entry: () => ({ ...review, undoToken: "undo_add" }),
    });

    expect(
      await run(
        [
          "add",
          "ajr/review",
          "-d",
          "45m",
          "-m",
          "PR #512",
          "--on",
          "yesterday",
        ],
        term.io,
      ),
    ).toBe(0);

    expect(term.out()).toBe(
      "   0:45  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov\n",
    );
    expect(term.err()).toBe("");
    expect(writes(term)).toEqual([
      {
        tool: "create_entry",
        input: {
          date: YESTERDAY,
          projectId: "p-ajr",
          taskId: "t-review",
          note: "PR #512",
          minutes: 45,
        },
      },
    ]);
    expect(await kept(term)).toBe("undo_add");
  });

  it("saves on today by default", async () => {
    const term = await ajour({
      list_projects: () => projects,
      create_entry: (input: { date: string }) => ({
        ...review,
        date: input.date,
        undoToken: "undo_add",
      }),
    });

    expect(await run(["add", "1", "-d", "0:30"], term.io)).toBe(0);

    expect(term.out()).toBe("   0:45  AJR  04 Review  PR #512  b7e1d04\n");
    expect(writes(term)).toEqual([
      {
        tool: "create_entry",
        input: {
          date: TODAY,
          projectId: "p-acme",
          taskId: "t-meet",
          minutes: 30,
        },
      },
    ]);
  });

  it("refuses a missing TASK or DURATION, a zero duration and a bad DAY with exit 2, before asking Ajour", async () => {
    const term = await ajour({});

    expect(await run(["add", "-d", "1:00"], term.io)).toBe(2);
    expect(await run(["add", "ajr/review"], term.io)).toBe(2);
    expect(await run(["add", "ajr/review", "-d", "0"], term.io)).toBe(2);
    expect(
      await run(
        ["add", "ajr/review", "-d", "1:00", "--on", "someday"],
        term.io,
      ),
    ).toBe(2);

    expect(term.err()).toBe(
      "usage: add takes a TASK, such as: ajour add ajr/review -d 45m\n" +
        "usage: add takes -d DURATION, such as: ajour add ajr/review -d 45m\n" +
        'usage: --duration takes a time such as 1:30, 1h30, 90m or 1.5, from 1 minute to 24 hours, not "0"\n' +
        'usage: "someday" isn\'t a day. Use today, yesterday, mon to sun, YYYY-MM-DD or MM-DD.\n',
    );
    expect(term.calls).toEqual([]);
  });
});

describe("ajour edit", () => {
  it("warns on stderr when a committed entry changes with --json", async () => {
    const output = {
      ...sync,
      state: "saved",
      note: "Changed",
      undoToken: "undo_edit",
    };
    const term = await ajour({
      find_entries: finder([sync]),
      edit_entry: () => output,
    });

    expect(
      await run(["edit", "91c0aa3", "-m", "Changed", "--json"], term.io),
    ).toBe(0);
    expect(JSON.parse(term.out())).toEqual(output);
    expect(term.err()).toBe(
      "Now differs from what Workday holds. It shows as updated on the Commit page.\n",
    );
  });
  it("changes a saved entry's time and prints its row with its day", async () => {
    const term = await ajour({
      find_entries: finder([review]),
      edit_entry: () => ({ ...review, minutes: 60, undoToken: "undo_edit" }),
    });

    expect(await run(["edit", "b7e1d04", "-d", "1:00"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "   1:00  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov\n",
    );
    expect(term.err()).toBe("");
    expect(writes(term)).toEqual([
      {
        tool: "edit_entry",
        input: { entryId: "timesheet_b7e1d04", minutes: 60 },
      },
    ]);
    expect(await kept(term)).toBe("undo_edit");
  });

  it('changes the task, and clears the note with -m ""', async () => {
    const term = await ajour({
      list_projects: () => projects,
      find_entries: finder([review]),
      edit_entry: () => ({
        ...review,
        taskId: "t-export",
        taskName: "07 Export",
        note: undefined,
        undoToken: "undo_edit",
      }),
    });

    expect(await run(["edit", "b7e1", "export", "-m", ""], term.io)).toBe(0);

    expect(term.out()).toBe("   0:45  AJR  07 Export  b7e1d04  Tue 3 Nov\n");
    expect(writes(term)).toEqual([
      {
        tool: "edit_entry",
        input: {
          entryId: "timesheet_b7e1d04",
          projectId: "p-ajr",
          taskId: "t-export",
          note: "",
        },
      },
    ]);
  });

  it("warns that a committed entry now differs from what Workday holds", async () => {
    const term = await ajour({
      find_entries: finder([sync]),
      edit_entry: (input: { note: string }) => ({
        ...sync,
        state: "saved",
        note: input.note,
        undoToken: "undo_edit",
      }),
    });

    expect(
      await run(
        ["edit", "91c0aa3", "-m", "Weekly sync, moved to 10:30"],
        term.io,
      ),
    ).toBe(0);

    expect(term.out()).toBe(
      "   0:45  ACME  03 Meetings  Weekly sync, moved to 10:30  91c0aa3\n",
    );
    expect(term.err()).toBe(
      "Now differs from what Workday holds. It shows as updated on the Commit page.\n",
    );
  });

  it("says nothing when the committed entry is left as Workday holds it", async () => {
    const term = await ajour({
      find_entries: finder([sync]),
      edit_entry: () => ({ ...sync, undoToken: null }),
    });

    expect(await run(["edit", "91c0", "-m", "Weekly sync"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "   0:45  ACME  03 Meetings  Weekly sync  ✓  91c0aa3\n",
    );
    expect(term.err()).toBe("");
  });

  it("edits the running entry when its id names it, and it keeps running", async () => {
    const term = await ajour({
      find_entries: finder([]),
      edit_running_entry: (input: { countedMinutes: number }) => ({
        running: { ...running, countedMinutes: input.countedMinutes },
        undoToken: "undo_running",
      }),
    });

    expect(await run(["edit", "3f9a2c1", "-d", "0"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "●  0:00  AJR  07 Export  Fix export rounding  3f9a2c1\n",
    );
    expect(writes(term)).toEqual([
      { tool: "edit_running_entry", input: { countedMinutes: 0 } },
    ]);
  });

  it("refuses zero minutes for a saved entry with exit 2, and changes nothing", async () => {
    const term = await ajour({ find_entries: finder([review]) });

    expect(await run(["edit", "b7e1d04", "-d", "0"], term.io)).toBe(2);

    expect(term.err()).toBe(
      'usage: --duration takes a time such as 1:30, 1h30, 90m or 1.5, from 1 minute to 24 hours, not "0"\n',
    );
    expect(writes(term)).toEqual([]);
  });
});

describe("ajour move and dup", () => {
  it("moves an entry to another day and prints the row with its new day", async () => {
    const term = await ajour({
      find_entries: finder([review]),
      move_entry: (input: { date: string }) => ({
        ...review,
        date: input.date,
        undoToken: "undo_move",
      }),
    });

    expect(await run(["move", "b7e1d04", "--to", "mon"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "   0:45  AJR  04 Review  PR #512  b7e1d04  Mon 2 Nov\n",
    );
    expect(writes(term)).toEqual([
      {
        tool: "move_entry",
        input: { entryId: "timesheet_b7e1d04", date: "2026-11-02" },
      },
    ]);
    expect(await kept(term)).toBe("undo_move");
  });

  it("names today when an entry lands on it", async () => {
    const term = await ajour({
      find_entries: finder([review]),
      move_entry: (input: { date: string }) => ({
        ...review,
        date: input.date,
        undoToken: "undo_move",
      }),
    });

    expect(await run(["move", "b7e1d04", "--to", "today"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "   0:45  AJR  04 Review  PR #512  b7e1d04  today\n",
    );
  });

  it("duplicates an entry to another day, or on its own day without --to", async () => {
    const term = await ajour({
      find_entries: finder([sync, review]),
      duplicate_entry: (input: { entryId: string; date?: string }) => {
        const source = input.entryId === sync.entryId ? sync : review;
        return {
          ...source,
          entryId: "timesheet_f0a9d12",
          shortId: hexId("f0a9d12"),
          state: "saved",
          date: input.date ?? source.date,
          undoToken: "undo_dup",
        };
      },
    });

    expect(await run(["dup", "91c0aa3", "--to", "fri"], term.io)).toBe(0);
    expect(await run(["dup", "b7e1d04"], term.io)).toBe(0);

    expect(term.out()).toBe(
      "   0:45  ACME  03 Meetings  Weekly sync  f0a9d12  Fri 30 Oct\n" +
        "   0:45  AJR  04 Review  PR #512  f0a9d12  Tue 3 Nov\n",
    );
    expect(writes(term)).toEqual([
      {
        tool: "duplicate_entry",
        input: { entryId: "timesheet_91c0aa3", date: "2026-10-30" },
      },
      { tool: "duplicate_entry", input: { entryId: "timesheet_b7e1d04" } },
    ]);
  });

  it("refuses move without --to with exit 2", async () => {
    const term = await ajour({});

    expect(await run(["move", "b7e1d04"], term.io)).toBe(2);
    expect(await run(["dup"], term.io)).toBe(2);

    expect(term.err()).toBe(
      "usage: move takes --to DAY, such as: ajour move b7e1d04 --to mon\n" +
        "usage: dup takes an ENTRY, such as: ajour dup last --to mon\n",
    );
    expect(term.calls).toEqual([]);
  });

  it("passes the running entry on, and prints Ajour's refusal", async () => {
    const term = await ajour({
      get_running_timer: () => ({ running }),
      move_entry: () => ({ refuse: "Stop the running entry first" }),
      duplicate_entry: () => ({ refuse: "Stop the running entry first" }),
    });

    expect(await run(["move", "running", "--to", "mon"], term.io)).toBe(1);
    expect(await run(["dup", "running"], term.io)).toBe(1);

    expect(term.err()).toBe(
      "refused: Stop the running entry first\n".repeat(2),
    );
    expect(writes(term)).toEqual([
      { tool: "move_entry", input: { entryId: "timer_1", date: "2026-11-02" } },
      { tool: "duplicate_entry", input: { entryId: "timer_1" } },
    ]);
  });
});

describe("ajour rm", () => {
  it("deletes every entry in one call and says how to undo", async () => {
    const term = await ajour({
      find_entries: finder([review, sync]),
      delete_entries: (input: { entryIds: string[] }) => ({
        deleted: input.entryIds.length,
        undoToken: "undo_rm",
      }),
    });

    expect(await run(["rm", "b7e1d04", "91c0", "b7e1"], term.io)).toBe(0);
    expect(await run(["rm", "b7e1d04"], term.io)).toBe(0);

    expect(term.out()).toBe("");
    expect(term.err()).toBe(
      "Deleted 2 entries. Undo with: ajour undo\n" +
        "Deleted 1 entry. Undo with: ajour undo\n",
    );
    expect(writes(term)).toEqual([
      {
        tool: "delete_entries",
        input: { entryIds: ["timesheet_b7e1d04", "timesheet_91c0aa3"] },
      },
      { tool: "delete_entries", input: { entryIds: ["timesheet_b7e1d04"] } },
    ]);
    expect(await kept(term)).toBe("undo_rm");
  });

  it("deletes nothing and exits 4 when one id finds no entry", async () => {
    const term = await ajour({
      find_entries: finder([review]),
      delete_entries: () => ({ deleted: 1, undoToken: "undo_rm" }),
    });

    expect(await run(["rm", "b7e1d04", "dead"], term.io)).toBe(4);

    expect(term.err()).toBe(
      'error: No entry has an id starting with "dead".\n',
    );
    expect(writes(term)).toEqual([]);
    await expect(stat(undoFile(term))).rejects.toThrow();
  });

  it("refuses an rm without an ENTRY with exit 2", async () => {
    const term = await ajour({});

    expect(await run(["rm"], term.io)).toBe(2);

    expect(term.err()).toBe(
      "usage: rm takes one or more ENTRY, such as: ajour rm b7e1d04\n",
    );
  });

  it("passes the running entry on, and prints Ajour's refusal", async () => {
    const term = await ajour({
      find_entries: finder([review]),
      get_running_timer: () => ({ running }),
      delete_entries: () => ({ refuse: "Stop the running entry first" }),
    });

    expect(await run(["rm", "b7e1d04", "running"], term.io)).toBe(1);

    expect(term.err()).toBe("refused: Stop the running entry first\n");
    expect(writes(term)).toEqual([
      {
        tool: "delete_entries",
        input: { entryIds: ["timesheet_b7e1d04", "timer_1"] },
      },
    ]);
  });

  it("prints the tool's output with --json", async () => {
    const term = await ajour({
      find_entries: finder([review]),
      delete_entries: () => ({ deleted: 1, undoToken: "undo_rm" }),
    });

    expect(await run(["rm", "b7e1d04", "--json"], term.io)).toBe(0);

    expect(JSON.parse(term.out())).toEqual({
      deleted: 1,
      undoToken: "undo_rm",
    });
    expect(term.err()).toBe("");
  });
});

describe("a submitted week", () => {
  it.each([
    ["add", ["add", "ajr/review", "-d", "1:00", "--on", "2026-10-14"]],
    ["edit", ["edit", "b7e1d04", "-d", "1:00"]],
    ["move", ["move", "b7e1d04", "--to", "2026-10-14"]],
    ["dup", ["dup", "b7e1d04", "--to", "10-14"]],
    ["rm", ["rm", "b7e1d04"]],
  ])("refuses %s with the lock's reason and exit 1", async (_name, args) => {
    const term = await ajour({
      list_projects: () => projects,
      find_entries: finder([review]),
      create_entry: () => ({ refuse: LOCKED }),
      edit_entry: () => ({ refuse: LOCKED }),
      move_entry: () => ({ refuse: LOCKED }),
      duplicate_entry: () => ({ refuse: LOCKED }),
      delete_entries: () => ({ refuse: LOCKED }),
    });

    expect(await run(args, term.io)).toBe(1);

    expect(term.out()).toBe("");
    expect(term.err()).toBe(`refused: ${LOCKED}\n`);
    await expect(stat(undoFile(term))).rejects.toThrow();
  });
});

describe("saved entries from the terminal", () => {
  it.each([
    ["add", ["add", "ajr/review", "-d", "45m"], "create_entry"],
    ["edit", ["edit", "b7e1d04", "-m", "Changed"], "edit_entry"],
    ["move", ["move", "b7e1d04", "--to", "mon"], "move_entry"],
    ["dup", ["dup", "b7e1d04"], "duplicate_entry"],
    ["rm", ["rm", "b7e1d04"], "delete_entries"],
  ])("undo uses the token returned by %s", async (name, args, tool) => {
    const term = await ajour({
      list_projects: () => projects,
      find_entries: finder([review]),
      [tool]: () =>
        tool === "delete_entries"
          ? { deleted: 1, undoToken: `undo_${name}` }
          : { ...review, undoToken: `undo_${name}` },
      undo: () => ({ undone: "Changed an entry", undoToken: null }),
    });

    expect(await run(args, term.io)).toBe(0);
    term.clear();
    expect(await run(["undo"], term.io)).toBe(0);
    expect(term.err()).toBe("Undid: Changed an entry\n");
    expect(writes(term).at(-1)).toEqual({
      tool: "undo",
      input: { undoToken: `undo_${name}` },
    });
    await expect(stat(undoFile(term))).rejects.toThrow();
  });
  it("runs add on another day, edit, undo, move, dup, rm of two entries and undo against a stand-in for Ajour", async () => {
    // The saved entries, and each write's Undo as a snapshot to go back to.
    let entries: AgentTimeEntry[] = [sync];
    const undos = new Map<
      string,
      { entries: AgentTimeEntry[]; undone: string }
    >();
    let next = 0;
    const remember = (undone: string) => {
      next += 1;
      const token = `undo_${next}`;
      undos.set(token, { entries: [...entries], undone });
      return token;
    };
    const find = (entryId: string) =>
      entries.find((entry) => entry.entryId === entryId)!;
    const replace = (entry: AgentTimeEntry) => {
      entries = entries.map((item) =>
        item.entryId === entry.entryId ? entry : item,
      );
      return entry;
    };
    const term = await ajour({
      list_projects: () => projects,
      find_entries: (input: { idPrefix: string }) => ({
        entries: entries.filter((entry) =>
          entry.shortId?.startsWith(input.idPrefix),
        ),
        running: null,
      }),
      create_entry: (input: {
        date: string;
        note?: string;
        minutes: number;
      }) => {
        const undoToken = remember("Added an entry");
        const entry: AgentTimeEntry = {
          ...review,
          date: input.date,
          minutes: input.minutes,
          ...(input.note ? { note: input.note } : {}),
        };
        entries = [...entries, entry];
        return { ...entry, undoToken };
      },
      edit_entry: (input: { entryId: string; minutes?: number }) => {
        const undoToken = remember("Edited an entry");
        const entry = find(input.entryId);
        return {
          ...replace({ ...entry, minutes: input.minutes ?? entry.minutes }),
          undoToken,
        };
      },
      move_entry: (input: { entryId: string; date: string }) => {
        const undoToken = remember("Moved an entry");
        return {
          ...replace({ ...find(input.entryId), date: input.date }),
          undoToken,
        };
      },
      duplicate_entry: (input: { entryId: string; date?: string }) => {
        const undoToken = remember("Duplicated an entry");
        const source = find(input.entryId);
        const copy: AgentTimeEntry = {
          ...source,
          entryId: "timesheet_f0a9d12",
          shortId: hexId("f0a9d12"),
          state: "saved",
          date: input.date ?? source.date,
        };
        entries = [...entries, copy];
        return { ...copy, undoToken };
      },
      delete_entries: (input: { entryIds: string[] }) => {
        const undoToken = remember(`Deleted ${input.entryIds.length} entries`);
        entries = entries.filter(
          (entry) => !input.entryIds.includes(entry.entryId),
        );
        return { deleted: input.entryIds.length, undoToken };
      },
      undo: (input: { undoToken: string }) => {
        const undo = undos.get(input.undoToken);
        if (!undo) return { refuse: "That change can't be undone any more." };
        entries = undo.entries;
        return { undone: undo.undone, undoToken: null };
      },
    });
    const step = async (args: string[]) => {
      term.clear();
      const code = await run(args, term.io);
      return { code, out: term.out(), err: term.err() };
    };
    const ids = () => entries.map((entry) => entry.shortId!.slice(0, 7));

    expect(
      await step([
        "add",
        "ajr/review",
        "-d",
        "45m",
        "-m",
        "PR #512",
        "--on",
        "yesterday",
      ]),
    ).toEqual({
      code: 0,
      out: "   0:45  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov\n",
      err: "",
    });
    expect(await step(["edit", "b7e1d04", "-d", "1:00"])).toEqual({
      code: 0,
      out: "   1:00  AJR  04 Review  PR #512  b7e1d04  Tue 3 Nov\n",
      err: "",
    });
    expect(await step(["undo"])).toEqual({
      code: 0,
      out: "",
      err: "Undid: Edited an entry\n",
    });
    expect(find("timesheet_b7e1d04").minutes).toBe(45);
    expect(await step(["move", "b7e1d04", "--to", "mon"])).toEqual({
      code: 0,
      out: "   0:45  AJR  04 Review  PR #512  b7e1d04  Mon 2 Nov\n",
      err: "",
    });
    expect(await step(["dup", "91c0aa3", "--to", "fri"])).toEqual({
      code: 0,
      out: "   0:45  ACME  03 Meetings  Weekly sync  f0a9d12  Fri 30 Oct\n",
      err: "",
    });
    expect(ids()).toEqual(["91c0aa3", "b7e1d04", "f0a9d12"]);
    expect(await step(["rm", "f0a9d12", "b7e1d04"])).toEqual({
      code: 0,
      out: "",
      err: "Deleted 2 entries. Undo with: ajour undo\n",
    });
    expect(ids()).toEqual(["91c0aa3"]);
    expect(await step(["undo"])).toEqual({
      code: 0,
      out: "",
      err: "Undid: Deleted 2 entries\n",
    });
    expect(ids()).toEqual(["91c0aa3", "b7e1d04", "f0a9d12"]);
    expect(await step(["undo"])).toEqual({
      code: 1,
      out: "",
      err: "Nothing to undo from here.\n",
    });
  });
});

describe("the manual for saved entries", () => {
  it.each(["add", "edit", "move", "dup", "rm"])(
    "shows the %s page with --help",
    async (name) => {
      const term = await ajour({});
      expect(await run([name, "--help"], term.io)).toBe(0);
      expect(term.out()).toMatch(new RegExp(`^ajour ${name} — `));
    },
  );

  it("lists the saved-entry commands and DAY on the card", async () => {
    const term = await ajour({});
    expect(await run(["--help"], term.io)).toBe(0);
    for (const line of [
      "add TASK -d DURATION [-m NOTE] [--on DAY]",
      "edit ENTRY [TASK] [-m NOTE] [-d DURATION]",
      "move ENTRY --to DAY",
      "dup ENTRY [--to DAY]",
      "rm ENTRY...",
      "DAY        today, yesterday, mon to sun",
    ]) {
      expect(term.out()).toContain(line);
    }
  });
});
