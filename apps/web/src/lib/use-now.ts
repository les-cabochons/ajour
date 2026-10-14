import { useEffect, useState, useSyncExternalStore } from "react";

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

const RUNNING_CLOCK_INTERVAL_MS = 1000;
const runningClockListeners = new Set<() => void>();
let runningClockNow = Date.now();
let runningClockIntervalId: number | undefined;

function subscribeRunningClock(listener: () => void) {
  runningClockListeners.add(listener);
  if (runningClockIntervalId === undefined) {
    runningClockNow = Date.now();
    runningClockIntervalId = window.setInterval(() => {
      runningClockNow = Date.now();
      for (const notify of runningClockListeners) notify();
    }, RUNNING_CLOCK_INTERVAL_MS);
  }

  return () => {
    runningClockListeners.delete(listener);
    if (runningClockListeners.size === 0) {
      window.clearInterval(runningClockIntervalId);
      runningClockIntervalId = undefined;
    }
  };
}

const subscribeStoppedClock = () => () => {};
const getRunningClockNow = () => runningClockNow;

/**
 * The current time, refreshed every second while `running`. Every running
 * readout shares one interval and ticks together. Call it in the component
 * that shows the running time, so the page around it does not re-render each
 * second.
 */
export function useRunningClock(running: boolean) {
  return useSyncExternalStore(
    running ? subscribeRunningClock : subscribeStoppedClock,
    getRunningClockNow,
  );
}
