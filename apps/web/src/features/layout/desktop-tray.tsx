import { useEffect } from "react";
import { getRunningEntryTrayState } from "@/domain/time/running-entry";
import type { DesktopTrayAction } from "@/lib/desktop-bridge";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

/**
 * The tray menu's Stop: stops the entry the menu showed, as the dock's Stop
 * does, while it still runs.
 */
export function runTrayAction(action: DesktopTrayAction) {
  if (action?.action !== "stop") return;
  const running = localStore
    .snapshot()
    .timers.find((timer) => timer._id === action.timerId);
  if (running) localStore.saveTimer(running._id);
}

/**
 * Keeps the desktop tray icon on the running entry (#534). It sends the
 * entry's title and times when they change, never each second: main counts
 * the time, so a hidden window's slowed timers don't hold the tooltip back.
 */
export function DesktopTrayState() {
  const state = useLocalState();
  const entry = getRunningEntryTrayState(state.timers[0] ?? null, state);
  const message = JSON.stringify({ entry });

  useEffect(() => {
    window.ajourDesktop?.setTrayState?.(JSON.parse(message));
  }, [message]);

  useEffect(() => window.ajourDesktop?.onTrayAction?.(runTrayAction), []);

  return null;
}
