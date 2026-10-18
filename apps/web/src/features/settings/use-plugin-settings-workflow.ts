import { syncTeamConnection } from "@/lib/team-sync";
import { useEffect, useState, useSyncExternalStore } from "react";
import * as appApi from "@/lib/app-api";
import { useRetryWhilePluginApiMissing } from "@/lib/use-plugin-api-retry";
import { createPluginSettingsWorkflow } from "./plugin-settings-workflow";

/** React adapter for the catalog and plugin-detail workflow. */
export function usePluginSettingsWorkflow() {
  const [workflow] = useState(() =>
    createPluginSettingsWorkflow({
      ...appApi,
      syncTeamConnection,
      subscribeCatalog: (listener) =>
        window.ajourDesktop?.onPluginCatalogUpdated?.(listener) ?? (() => {}),
    }),
  );
  const snapshot = useSyncExternalStore(
    workflow.subscribe,
    workflow.getSnapshot,
  );
  useEffect(() => workflow.connect(), [workflow]);
  useRetryWhilePluginApiMissing(snapshot.pluginApiMissing, workflow.refresh);
  return { ...snapshot, workflow };
}
