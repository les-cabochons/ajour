import { describe, expect, it } from "vitest";
import type {
  AgentRunnerOverview,
  AgentTaskStatus,
} from "@ajour/shared/agent-runs";
import { getAgentTaskPresence, isAgentRunGoing } from "./agent-task-buttons";

const submitTask = {
  pluginId: "ajp-workday",
  pluginName: "Workday",
  taskId: "submit-week",
  label: "Check Workday and submit",
  placement: "submit-week",
  estimateMinutes: 10,
  settings: [],
  values: {},
  blockers: [],
} satisfies AgentTaskStatus;

const overview = (tasks: AgentTaskStatus[]): AgentRunnerOverview => ({
  settings: { cli: "claude-code", browserMode: "ajour-chrome", model: "" },
  clis: [],
  tasks,
  currentRun: null,
});

describe("getAgentTaskPresence", () => {
  it("does not know yet while the overview loads", () => {
    expect(getAgentTaskPresence({ kind: "loading" }, "submit-week")).toBe(
      "loading",
    );
  });

  it("finds a task for the placement once the overview loaded", () => {
    const state = { kind: "ready", overview: overview([submitTask]) } as const;

    expect(getAgentTaskPresence(state, "submit-week")).toBe("present");
    expect(getAgentTaskPresence(state, "commit-week")).toBe("absent");
  });

  it("has no task without the local API or when the overview failed", () => {
    expect(getAgentTaskPresence({ kind: "unavailable" }, "submit-week")).toBe(
      "absent",
    );
    expect(
      getAgentTaskPresence({ kind: "error", message: "Down" }, "submit-week"),
    ).toBe("absent");
  });
});

describe("isAgentRunGoing", () => {
  const ready = { kind: "ready", overview: overview([submitTask]) } as const;

  it("is idle with no current run and no runner session", () => {
    expect(isAgentRunGoing(ready, [])).toBe(false);
    expect(isAgentRunGoing({ kind: "loading" }, [])).toBe(false);
    expect(isAgentRunGoing(ready, [{ runId: "run-1", state: "ended" }])).toBe(
      false,
    );
    // A session the user opened, not the runner.
    expect(isAgentRunGoing(ready, [{ state: "active" }])).toBe(false);
  });

  it("is going while the API reports a current run", () => {
    const state = {
      kind: "ready",
      overview: {
        ...overview([submitTask]),
        currentRun: {
          id: "run-1",
          pluginId: "ajp-workday",
          taskId: "submit-week",
          weekOf: "2026-10-12",
          sessionId: "session-1",
          startedAt: 0,
        },
      },
    } as const;
    expect(isAgentRunGoing(state, [])).toBe(true);
  });

  it("is going while a runner session is active or stalled", () => {
    expect(isAgentRunGoing(ready, [{ runId: "run-1", state: "active" }])).toBe(
      true,
    );
    expect(isAgentRunGoing(ready, [{ runId: "run-1", state: "stalled" }])).toBe(
      true,
    );
  });
});
