import { useEffect } from "react";
import { connectMcpBridge } from "@/lib/mcp-bridge";
import { useMcpSettings } from "@/lib/mcp-settings";
import { setAgentBridgeStatus } from "@/features/agents/agent-bridge-state";
import { runAgentToolCall } from "@/features/agents/agent-tool-runner";

/** Keeps the MCP bridge open while MCP is on. Mount once, in the app shell. */
export function AgentBridgeHost() {
  const settings = useMcpSettings();
  const enabled = settings.kind === "ready" && settings.settings.enabled;

  useEffect(() => {
    if (!enabled) {
      setAgentBridgeStatus("off");
      return;
    }
    return connectMcpBridge({
      runToolCall: runAgentToolCall,
      onStatus: setAgentBridgeStatus,
    });
  }, [enabled]);

  return null;
}
