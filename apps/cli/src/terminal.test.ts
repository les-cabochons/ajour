import { afterEach, expect, it } from "vitest";
import { run } from "./main.ts";
import {
  ajour,
  closeTerminals,
  projects,
  TODAY,
  writes,
} from "./test-support/terminal.ts";
import { running } from "./test-support/log-week.ts";

afterEach(closeTerminals);

it("starts an entry through the real API, reads it in log and undoes the terminal change", async () => {
  let active = false;
  const term = await ajour({
    list_projects: () => projects,
    start_timer: () => {
      active = true;
      return { running, undoToken: "terminal-start" };
    },
    list_time_entries: () => ({
      entries: [],
      running: active ? running : null,
      targets: [{ date: TODAY, hours: 8 }],
    }),
    undo: () => {
      active = false;
      return { undone: "Start entry", undoToken: null };
    },
  });
  expect(
    await run(["start", "AJR/Export", "-m", "Fix export rounding"], term.io),
  ).toBe(0);
  term.clear();
  expect(await run(["log", "--json"], term.io)).toBe(0);
  expect(JSON.parse(term.out()).running.note).toBe("Fix export rounding");
  term.clear();
  expect(await run(["undo"], term.io)).toBe(0);
  expect(writes(term).map((c) => c.tool)).toEqual(["start_timer", "undo"]);
  expect(term.calls.find((c) => c.tool === "start_timer")?.client.name).toBe(
    "Terminal",
  );
  term.clear();
  expect(await run(["log", "--json"], term.io)).toBe(0);
  expect(JSON.parse(term.out()).running).toBeNull();
});

it("prints the initialize server version when connected, without needing a window tool", async () => {
  const term = await ajour({}, "9.8.7");
  expect(await run(["-V"], term.io)).toBe(0);
  expect(term.out()).toMatch(/^ajour \d+\.\d+\.\d+\nAjour 9\.8\.7\n$/);
  expect(term.calls).toHaveLength(0);
});

it("omits an unknown app version from the standalone API", async () => {
  const term = await ajour({});
  expect(await run(["-V"], term.io)).toBe(0);
  expect(term.out()).toMatch(/^ajour \d+\.\d+\.\d+\n$/);
});
