import { useEffect } from "react";
import { getAgentIndicator } from "@/domain/agents/agent-indicator";
import { useMcpSettings } from "@/lib/mcp-settings";
import { cn } from "@/lib/utils";
import {
  closeAgentPanel,
  openAgentPanel,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";

/**
 * One dot per state. A failed session, which the agent reported, is a red
 * ring; an error in Ajour or its connection is a solid red dot.
 */
const DOT_CLASS = {
  idle: "bg-muted-foreground",
  active: "bg-success",
  "needs-input": "bg-warning",
  failed: "border-2 border-destructive",
  error: "bg-destructive",
} as const;

/**
 * How far the toasts rise in a full window while the indicator shows: its
 * height plus a gap. In the narrow view the toasts already clear it.
 */
const INDICATOR_CLEARANCE = "2.5rem";

/**
 * The corner control for agents. Present whenever MCP is on. Its label and
 * color give the most urgent state. Idle shows only its dot until hovered
 * or keyboard-focused; its accessible name always includes the full label.
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
      data-state={indicator.state}
      aria-label={`Agents: ${indicator.label}`}
      aria-expanded={panelOpen}
      onClick={panelOpen ? closeAgentPanel : openAgentPanel}
      className={cn(
        "ajour-agent-indicator fixed right-4 bottom-4 z-50 flex h-[var(--control-height)] items-center gap-2 rounded-[var(--radius-md)] border border-border bg-popover px-3 text-xs text-popover-foreground shadow-[var(--shadow-popup)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        indicator.state === "needs-input" && "border-warning",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          DOT_CLASS[indicator.state],
        )}
      />
      <span className="ajour-agent-indicator-label">{indicator.label}</span>
    </button>
  );
}
