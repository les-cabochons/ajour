import { useEffect } from "react";
import { getAgentIndicator } from "@/domain/agents/agent-indicator";
import { useMcpSettings } from "@/lib/mcp-settings";
import { cn } from "@/lib/utils";
import {
  closeAgentPanel,
  openAgentPanel,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";

const DOT_CLASS = {
  idle: "bg-muted-foreground",
  active: "bg-success",
  "needs-input": "bg-warning",
  failed: "bg-destructive",
  error: "bg-destructive",
} as const;

/** How far the toasts rise while the indicator shows: its height plus a gap. */
const INDICATOR_CLEARANCE = "2.5rem";

/**
 * The corner control for agents. Present whenever MCP is on. Its label and
 * color give the most urgent state, so color is never the only signal.
 * Clicking it opens the agent panel, or closes it while it is open.
 */
export function AgentIndicator() {
  const settings = useMcpSettings();
  const { status, snapshot, panelOpen } = useAgentBridgeState();
  const indicator = getAgentIndicator({
    mcpEnabled: settings.kind === "ready" && settings.settings.enabled,
    bridgeStatus: status,
    snapshot,
  });
  const visible = indicator.state !== "hidden";

  // The toast viewport reads this variable to sit above the indicator.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) {
      root.style.setProperty(
        "--agent-indicator-clearance",
        INDICATOR_CLEARANCE,
      );
    }
    return () => {
      root.style.removeProperty("--agent-indicator-clearance");
    };
  }, [visible]);

  if (indicator.state === "hidden") return null;

  return (
    <button
      type="button"
      aria-label={`Agents: ${indicator.label}`}
      aria-expanded={panelOpen}
      onClick={panelOpen ? closeAgentPanel : openAgentPanel}
      className={cn(
        "fixed right-4 bottom-4 z-50 flex h-[var(--control-height)] items-center gap-2 rounded-[var(--radius-md)] border border-border bg-popover px-3 text-xs text-popover-foreground shadow-[var(--shadow-popup)]",
        "narrow:bottom-[var(--narrow-timer-clearance)]",
        indicator.state === "needs-input" && "border-warning",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", DOT_CLASS[indicator.state])}
      />
      {indicator.label}
    </button>
  );
}
