import { useCallback, useEffect, useState } from "react";
import type { LocalLogSettings } from "@ajour/wide-events/local-log-file.ts";
import type { DesktopLogsStatus } from "@/lib/desktop-bridge";
import { traceCarrier } from "@/lib/wide-events";

/** Whether this window can reach the local log file: the desktop app's bridge. */
export function hasLocalLogsBridge(): boolean {
  return typeof window !== "undefined" && !!window.ajourDesktop?.getLogsStatus;
}

/**
 * The local log file's settings and state, from the main process. Every
 * change goes through `logs.configure` and shows what main answers, so a
 * refused call leaves the stored values on screen and says so. One call runs
 * at a time: `busy` is true until it answers.
 */
export function useLocalLogs() {
  const [status, setStatus] = useState<DesktopLogsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = window.ajourDesktop?.getLogsStatus;
    if (!load) return;
    let current = true;
    load(traceCarrier())
      .then((loaded) => {
        if (current) setStatus(loaded);
      })
      .catch(() => {
        if (current) setError("Couldn't read the log settings.");
      });
    return () => {
      current = false;
    };
  }, []);

  /** Runs one bridge call; `failure` is the line to show when it is refused. */
  const run = useCallback(
    async (
      call: () => Promise<DesktopLogsStatus | void> | undefined,
      failure: string,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const next = await call();
        if (next) setStatus(next);
      } catch {
        setError(failure);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    status,
    error,
    busy,
    configure: (changes: Partial<LocalLogSettings>) =>
      run(
        () => window.ajourDesktop?.configureLogs?.(changes, traceCarrier()),
        "Couldn't save the setting. The log settings stay as they were.",
      ),
    deleteAll: () =>
      run(
        () => window.ajourDesktop?.deleteAllLogs?.(traceCarrier()),
        "Couldn't delete the logs.",
      ),
    openFolder: () =>
      run(
        () => window.ajourDesktop?.openLogsFolder?.(traceCarrier()),
        "Couldn't open the log folder.",
      ),
  };
}
