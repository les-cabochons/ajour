import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs`. Snoozes end on their own, so
 * views that hide snoozed items re-render with it to bring them back.
 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
