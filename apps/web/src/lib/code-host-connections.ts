import { useSyncExternalStore } from "react";
import { enabledCodeHostGroups } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  getCachedPluginsOverview,
  subscribePluginsOverview,
} from "@/lib/app-api";

/** All consumers share the validated overview, including activation changes. */
export function useCodeHostConnections() {
  const overview = useSyncExternalStore(
    subscribePluginsOverview,
    getCachedPluginsOverview,
    getCachedPluginsOverview,
  );
  const groups = enabledCodeHostGroups(overview);
  // Deck and its navigation show while this holds.
  return { overview, groups, enabled: groups.length > 0 };
}
