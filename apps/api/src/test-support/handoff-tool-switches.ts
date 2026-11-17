import { dispatchJsonRequest } from "./dispatch-json-request.ts";
import type { AppApiStorage } from "../storage.ts";

/**
 * Turns on the named handoff tools, by plugin id, as the plugin page's
 * switches do: every tool starts off (#760), so a test that hands off
 * turns its tools on first.
 */
export async function turnOnHandoffTools(
  storage: Pick<AppApiStorage, "setHandoffToolEnabled">,
  tools: Record<string, readonly string[]>,
) {
  for (const [pluginId, ids] of Object.entries(tools))
    for (const toolId of ids)
      await storage.setHandoffToolEnabled(pluginId, toolId, true);
}

/** The same, through the API's own route, for a test that runs the server. */
export async function turnOnServerHandoffTools(
  server: Parameters<typeof dispatchJsonRequest>[0],
  tools: Record<string, readonly string[]>,
) {
  for (const [pluginId, ids] of Object.entries(tools))
    for (const toolId of ids) {
      const response = await dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/${encodeURIComponent(pluginId)}/handoffs/tools`,
        body: JSON.stringify({ toolId, enabled: true }),
      });
      if (response.status !== 200)
        throw new Error(
          `Could not turn on ${pluginId}:${toolId}: ${JSON.stringify(response.body)}`,
        );
    }
}
