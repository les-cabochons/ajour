import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentSession, AgentsSnapshot } from "@ajour/shared/agent-tools";
import { AgentPanel } from "./agent-panel";

const noop = async () => undefined;
const link = { label: "Open the week in Workday", url: "https://wd.example/t" };

function snapshotWith(session: Partial<AgentSession>): AgentsSnapshot {
  return {
    sessions: [
      {
        id: "s1",
        client: { id: "c1", name: "Claude Code" },
        title: "Enter in Workday",
        state: "active",
        startedAt: 0,
        messages: [],
        ...session,
      },
    ],
    openQuestions: [],
    activity: [],
    errors: [],
    seenAt: 0,
  };
}

function renderPanel(snapshot: AgentsSnapshot, currentRunId?: string | null) {
  return renderToStaticMarkup(
    <AgentPanel
      snapshot={snapshot}
      open
      onOpenChange={() => {}}
      onAnswer={noop}
      onDismiss={noop}
      onStop={noop}
      currentRunId={currentRunId}
      onSeen={() => {}}
    />,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("agent panel runner sessions", () => {
  it("offers Stop, not Dismiss, on an open runner session", () => {
    const markup = renderPanel(
      snapshotWith({ runId: "run-1", state: "stalled" }),
    );
    expect(markup).toContain(">Stop</button>");
    expect(markup).not.toContain(">Dismiss</button>");
  });

  it("shows the session's link once it ends", () => {
    const markup = renderPanel(
      snapshotWith({ runId: "run-1", state: "done", link }),
    );
    expect(markup).toContain('href="https://wd.example/t"');
    expect(markup).toContain(">Open the week in Workday</a>");
    expect(markup).not.toContain(">Stop</button>");
  });

  it("keeps Stop on an ended runner session while its run is current", () => {
    const ended = snapshotWith({ runId: "run-1", state: "done", link });
    expect(renderPanel(ended, "run-1")).toContain(">Stop</button>");
    expect(renderPanel(ended, "run-2")).not.toContain(">Stop</button>");
    expect(renderPanel(ended, null)).not.toContain(">Stop</button>");
  });
});
