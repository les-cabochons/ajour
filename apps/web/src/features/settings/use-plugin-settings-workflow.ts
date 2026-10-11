import { useEffect, useState, useSyncExternalStore } from "react";
import * as appApi from "@/lib/app-api";
import { createPluginSettingsWorkflow } from "./plugin-settings-workflow";

/** React adapter for the catalog and plugin-detail workflow. */
export function usePluginSettingsWorkflow() {
  const [workflow] = useState(() =>
    createPluginSettingsWorkflow({
      ...appApi,
      subscribeCatalog: (listener) =>
        window.ajourDesktop?.onPluginCatalogUpdated?.(listener) ?? (() => {}),
    }),
  );
  const snapshot = useSyncExternalStore(
    workflow.subscribe,
    workflow.getSnapshot,
  );
  useEffect(() => workflow.connect(), [workflow]);
  return { ...snapshot, workflow };
}
