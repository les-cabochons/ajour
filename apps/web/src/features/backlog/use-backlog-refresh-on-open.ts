import { useEffect, useRef } from "react";
import { refreshBacklog } from "./backlog-refresh-workflow";

/** A visit refreshes once; StrictMode and store writes are not new visits. */
export function useBacklogRefreshOnOpen() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void refreshBacklog({ trigger: "auto" });
  }, []);
}
