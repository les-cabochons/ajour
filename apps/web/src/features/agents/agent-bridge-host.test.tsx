// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Handoff } from "@ajour/shared/handoffs";
import { setHandoffs, useHandoffs } from "@/lib/handoffs";
import { useAgentBridgeState } from "./agent-bridge-state";
import { AgentBridgeHost } from "./agent-bridge-host";

const { settings, runToolCall, postResult, setVisibility } = vi.hoisted(() => ({
  settings: { enabled: true },
  runToolCall: vi.fn(async () => ({
    requestId: "call-1",
    ok: true,
    output: null,
  })),
  postResult: vi.fn(async () => ({ ok: true })),
  setVisibility: vi.fn(async () => undefined),
}));
vi.mock("@/lib/mcp-settings", () => ({
  useMcpSettings: () => ({ kind: "ready", settings }),
}));
vi.mock("@/lib/app-api", () => ({
  appApiUrl: (path: string) => `http://window.test${path}`,
  postMcpBridgeResult: postResult,
  setHandoffVisibility: setVisibility,
}));
vi.mock("./agent-tool-runner", () => ({
  runAgentToolCall: runToolCall,
  agentToolCallTurn: () => undefined,
}));

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  send(event: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) }));
  }
}

const handoff: Handoff = {
  id: "h",
  pluginId: "p",
  toolId: "t",
  workItemId: "i",
  projectId: "p",
  folderId: "f",
  title: "Thread",
  threadId: "thread",
  native: {},
  state: "working",
  startedAt: 1,
  checkedAt: 1,
  changedAt: 1,
  history: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeEventSource.instances = [];
});

it.each([true, false])(
  "receives handoffs with MCP enabled=%s and uses the MCP tool route only when enabled",
  async (enabled) => {
    settings.enabled = enabled;
    vi.stubGlobal("EventSource", FakeEventSource);
    setHandoffs([]);
    render(<AgentBridgeHost />);
    const records = renderHook(() => useHandoffs());
    const bridge = renderHook(() => useAgentBridgeState());
    const stream = FakeEventSource.instances[0]!;
    expect(stream.url).toBe(
      `http://window.test/api/${enabled ? "mcp" : "handoffs"}/bridge`,
    );
    act(() => {
      stream.onopen?.();
      stream.send("handoffs", [handoff]);
    });
    expect(records.result.current).toEqual([handoff]);
    expect(bridge.result.current.status).toBe(enabled ? "connected" : "off");
    expect(setVisibility).toHaveBeenCalledWith(true);
    if (enabled) {
      act(() =>
        stream.send("tool-call", {
          requestId: "call-1",
          tool: "start_timer",
          input: {},
          client: { id: "c", name: "Agent" },
        }),
      );
      await waitFor(() =>
        expect(postResult).toHaveBeenCalledWith({
          requestId: "call-1",
          ok: true,
          output: null,
        }),
      );
      expect(runToolCall).toHaveBeenCalledOnce();
    } else {
      expect(runToolCall).not.toHaveBeenCalled();
    }
  },
);
