import { describe, expect, it } from "vitest";
import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../../packages/shared/agent-tools.ts";
import {
  displayIds,
  entryRow,
  formatDay,
  formatRows,
  runningRow,
} from "./rows.ts";
import { painter } from "./style.ts";

const TODAY = "2026-11-04";
const plain = { paint: painter(false), today: TODAY };

const running: AgentRunningTimer = {
  timerId: "timer_1",
  shortId: "91c0aa3d5e6f40718293a4b5c6d7e8f9",
  date: TODAY,
  countedMinutes: 0,
  projectCode: "ACME",
  projectName: "Acme",
  taskName: "03 Meetings",
  note: "Weekly sync",
};

const saved: AgentTimeEntry = {
  entryId: "timesheet_c41ee90a-0000-4000-8000-000000000000",
  shortId: "c41ee90a000040008000000000000000",
  date: TODAY,
  state: "saved",
  minutes: 88,
  projectCode: "ACME",
  projectName: "Acme",
  taskName: "05 Backend",
  note: "Rate limiter retries",
};

describe("rows", () => {
  it("prints a Switch: the saved row, then the running one, aligned", () => {
    expect(
      formatRows(
        [{ ...entryRow(saved), tag: "saved" }, runningRow(running)],
        plain,
      ),
    ).toBe(
      "   1:28  ACME  05 Backend   Rate limiter retries  c41ee90  saved\n" +
        "●  0:00  ACME  03 Meetings  Weekly sync           91c0aa3\n",
    );
  });

  it("marks a committed entry and names a day that isn't today", () => {
    expect(
      formatRows(
        [
          { ...entryRow(saved), committed: true },
          entryRow({
            ...saved,
            shortId: "b7e1d04f",
            date: "2026-11-03",
            minutes: 45,
            taskName: "04 Review",
            note: "PR #512",
            projectCode: "AJR",
          }),
        ],
        plain,
      ),
    ).toBe(
      "   1:28  ACME  05 Backend  Rate limiter retries  ✓  c41ee90\n" +
        "   0:45  AJR   04 Review   PR #512                  b7e1d04  Tue 3 Nov\n",
    );
  });

  it("shows an empty entry as untitled, and a project without a code by its name", () => {
    expect(
      formatRows(
        [
          runningRow({
            timerId: "timer_2",
            shortId: "7a20b1c0",
            date: TODAY,
            countedMinutes: 0,
          }),
          runningRow({
            ...running,
            projectCode: undefined,
            projectName: "Internal",
            taskName: undefined,
            note: undefined,
          }),
        ],
        plain,
      ),
    ).toBe(
      "●  0:00  —         —  Untitled entry  7a20b1c\n" +
        "●  0:00  Internal  —                  91c0aa3\n",
    );
  });

  it("keeps a note on one line, and cuts it first to fit the terminal", () => {
    const long = {
      ...entryRow(saved),
      note: "Rate limiter retries\nwith jitter and a cap",
    };
    expect(formatRows([long], plain)).toBe(
      "   1:28  ACME  05 Backend  Rate limiter retries with jitter and a cap  c41ee90\n",
    );
    expect(formatRows([long], { ...plain, columns: 42 })).toBe(
      "   1:28  ACME  05 Backend  Rate…  c41ee90\n",
    );
    // Narrower than the fixed columns: the line itself is cut.
    expect(formatRows([long], { ...plain, columns: 21 })).toBe(
      "   1:28  ACME  05 B…\n",
    );
  });

  it("paints the mark, mutes ids and untitled text, and pads by the plain width", () => {
    const text = formatRows(
      [
        runningRow(running),
        runningRow({
          timerId: "t",
          shortId: "7a20b1c0",
          date: TODAY,
          countedMinutes: 5,
        }),
      ],
      { paint: painter(true), today: TODAY },
    );
    expect(text).toContain("\x1b[32m●\x1b[0m");
    expect(text).toContain("\x1b[90m91c0aa3\x1b[0m");
    expect(text).toContain("\x1b[90mUntitled entry\x1b[0m");
    expect(text.replace(/\x1b\[[0-9;]*m/g, "")).toBe(
      "●  0:00  ACME  03 Meetings  Weekly sync     91c0aa3\n" +
        "●  0:05  —     —            Untitled entry  7a20b1c\n",
    );
  });

  it("lengthens the print's ids when two share their first 7 characters, and keeps an old id whole", () => {
    expect(
      displayIds([
        "3f9a2c1aaaaa0000",
        "3f9a2c1bbbbb0000",
        "91c0aa3d0000",
        "timesheet_old",
      ]),
    ).toEqual(["3f9a2c1a", "3f9a2c1b", "91c0aa3d", "timesheet_old"]);
    expect(displayIds(["3f9a2c1a", "3f9a2c1a"])).toEqual([
      "3f9a2c1",
      "3f9a2c1",
    ]);
  });

  it("names a day as the prints do", () => {
    expect(formatDay("2026-11-03")).toBe("Tue 3 Nov");
    expect(formatDay("2026-01-12")).toBe("Mon 12 Jan");
  });
});
