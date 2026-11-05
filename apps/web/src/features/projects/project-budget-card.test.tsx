// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalProjectSource,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import { ProjectBudgetCard } from "@/features/projects/project-budget-card";
import { installDomShims } from "@/test-support/dom";

/*
 * A managed project's budget card (#509): the source's figures with their
 * time, Not counted yet, the estimated Remaining, and the note on the
 * user's own hours.
 */

const HOUR = 3_600_000;
// Midday, so the day reads Oct 31 in any test machine's time zone.
const AS_OF = "2026-10-31T16:00:00.000Z";
const BEFORE = Date.parse("2026-10-30T12:00:00.000Z");

function managedProject(budget: LocalProject["budget"]): LocalProject {
  return {
    _id: "acme",
    name: "Acme - Support",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    source: {
      pluginId: "example-project-source",
      connectionId: "c1",
      remoteId: "ACME-SUP",
      syncedAt: 1,
    },
    budget,
    tasks: [
      {
        _id: "login",
        name: "Ticket #101 - Login",
        status: "active",
        createdAt: 1,
        budgetMs: 8 * HOUR,
        source: { remoteId: "1001", assigned: true, myHours: 5.25 },
      },
    ],
  };
}

const hoursBudget = {
  unit: "hours" as const,
  total: 40,
  consumed: 31.5,
  remaining: 8.5,
  asOf: AS_OF,
};

function source(me: LocalProjectSource["me"]): LocalProjectSource {
  return {
    pluginId: "example-project-source",
    label: "Example planner",
    asOf: AS_OF,
    ...(me ? { me } : {}),
    syncedAt: 1,
    held: [],
  };
}

function entry(
  id: string,
  overrides: Partial<LocalTimesheetEntry>,
): LocalTimesheetEntry {
  return {
    _id: id,
    localDate: "2026-10-28",
    projectId: "acme",
    taskId: "login",
    label: "",
    durationMs: 3 * HOUR,
    sourceBlockIds: [],
    committedAt: 1,
    ...overrides,
  };
}

/** 3:00 committed before the source's time, and 2:00 not committed yet. */
const entries = [
  entry("committed", {
    commit: {
      at: BEFORE,
      localDate: "2026-10-28",
      projectId: "acme",
      taskId: "login",
      durationMs: 3 * HOUR,
    },
  }),
  entry("new", { localDate: "2026-11-02", durationMs: 2 * HOUR }),
];

function figure(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

describe("ProjectBudgetCard", () => {
  beforeAll(() => installDomShims());
  afterEach(cleanup);

  it("shows the source's figures with their time, Not counted yet and the estimated Remaining", () => {
    render(
      <ProjectBudgetCard
        project={managedProject(hoursBudget)}
        entries={entries}
        source={source({ hoursAvailable: true })}
      />,
    );

    expect(figure("Budget")).toBe("40:00");
    expect(figure("Consumed")).toMatch(/^31:30as of Oct 31/);
    expect(figure("Not counted yet")).toBe("2:00");
    expect(figure("≈ Remaining")).toBe("6:30Estimate: 8:30 − 2:00");
  });

  it("says what the source has for the user, and lists the committed entries when they differ", () => {
    render(
      <ProjectBudgetCard
        project={managedProject(hoursBudget)}
        entries={entries}
        source={source({ hoursAvailable: true })}
      />,
    );

    expect(
      screen.getByText(
        /^Example planner has 5h15 for you\. You committed 3h before Oct 31/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Ticket #101 - Login")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "See the 2h15" }));

    const list = screen.getByRole("list", { name: "Committed entries" });
    expect(list.textContent).toContain("Ticket #101 - Login");
    expect(list.textContent).toContain("Example planner 5:15");
    expect(list.textContent).toContain("You 3:00");
    expect(list.textContent).toContain("3:00");
  });

  it("offers no list when what the user committed matches", () => {
    const matching = managedProject(hoursBudget);
    matching.tasks[0]!.source!.myHours = 3;

    render(
      <ProjectBudgetCard
        project={matching}
        entries={entries}
        source={source({ hoursAvailable: true })}
      />,
    );

    expect(screen.getByText(/has 3h for you\. You committed 3h/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^See the/ })).toBeNull();
  });

  it("shows the plugin's note when the source can't give the user's hours, and nothing without one", () => {
    const { rerender } = render(
      <ProjectBudgetCard
        project={managedProject(hoursBudget)}
        entries={entries}
        source={source({
          hoursAvailable: false,
          hoursNote:
            "Link your account in Example planner to compare your hours.",
        })}
      />,
    );

    expect(
      screen.getByText(
        "Link your account in Example planner to compare your hours.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/for you\./)).toBeNull();

    rerender(
      <ProjectBudgetCard
        project={managedProject(hoursBudget)}
        entries={entries}
        source={source({ hoursAvailable: false })}
      />,
    );

    expect(screen.queryByText(/Link your account/)).toBeNull();
    expect(screen.queryByText(/for you\./)).toBeNull();
  });

  it("shows only the source's status for a money budget, and still the note", () => {
    render(
      <ProjectBudgetCard
        project={managedProject({
          unit: "money",
          total: 20000,
          consumed: 21200,
          remaining: -1200,
          status: "over",
          asOf: AS_OF,
        })}
        entries={entries}
        source={source({ hoursAvailable: true })}
      />,
    );

    expect(figure("Status")).toMatch(/^Over budgetas of Oct 31/);
    expect(screen.queryByText("Budget", { selector: "dt" })).toBeNull();
    expect(screen.queryByText("Not counted yet")).toBeNull();
    expect(screen.queryByText("≈ Remaining")).toBeNull();
    expect(screen.queryByText(/20000|21200|1200/)).toBeNull();
    expect(screen.getByText(/has 5h15 for you/)).toBeTruthy();
  });
});
