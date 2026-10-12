import { useSyncExternalStore } from "react";
import { enabledCodeHostGroups } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  getCachedConnectorsOverview,
  subscribeConnectorsOverview,
} from "@/lib/app-api";

/** All consumers share the validated overview, including activation changes. */
export function useCodeHostConnections() {
  const overview = useSyncExternalStore(
    subscribeConnectorsOverview,
    getCachedConnectorsOverview,
    getCachedConnectorsOverview,
  );
  return { overview, groups: enabledCodeHostGroups(overview) };
}
