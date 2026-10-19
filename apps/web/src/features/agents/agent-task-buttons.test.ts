import { describe, expect, it } from "vitest";
import type {
  AgentRunnerOverview,
  AgentTaskStatus,
} from "@ajour/shared/agent-runs";
import { getAgentTaskPresence } from "./agent-task-buttons";

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
