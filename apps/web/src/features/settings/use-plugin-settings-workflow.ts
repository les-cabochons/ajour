import { syncTeamConnection } from "@/lib/team-sync";
import { useEffect, useState, useSyncExternalStore } from "react";
import * as appApi from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { useRetryWhilePluginApiMissing } from "@/lib/use-plugin-api-retry";
import {
  connectionHeldEditCount,
  discardConnectionHeldEdits,
} from "@/features/backlog/held-edit-review";
import {
  createPluginSettingsWorkflow,
  type PluginSettingsDependencies,
} from "./plugin-settings-workflow";

/** The app's own adapters for the plugin settings workflow. */
export function appPluginSettingsDependencies(): PluginSettingsDependencies {
  return {
    ...appApi,
    syncTeamConnection,
    subscribeCatalog: (listener) =>
      window.ajourDesktop?.onPluginCatalogUpdated?.(listener) ?? (() => {}),
    holdPendingEstimates: (connection) =>
      localStore.holdPendingEstimates(connection),
    connectionHeldEditCount,
    discardConnectionHeldEdits,
  };
}

/** React adapter for the catalog and plugin-detail workflow. */
export function usePluginSettingsWorkflow() {
  const [workflow] = useState(() =>
    createPluginSettingsWorkflow(appPluginSettingsDependencies()),
  );
  const snapshot = useSyncExternalStore(
    workflow.subscribe,
    workflow.getSnapshot,
  );
  useEffect(() => workflow.connect(), [workflow]);
  useRetryWhilePluginApiMissing(snapshot.pluginApiMissing, workflow.refresh);
  return { ...snapshot, workflow };
}
