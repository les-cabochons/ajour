import { useSyncExternalStore } from "react";
import type { DesktopUpdateState } from "@/lib/desktop-bridge";
import type { UpdateTrack } from "@/domain/local-state";

let snapshot: DesktopUpdateState = {
  status: "idle",
  track: null,
  result: null,
  progress: null,
  error: null,
  canInstall: false,
};
let revision = 0;
const listeners = new Set<() => void>();
let disconnect: (() => void) | undefined;
let subscriptionGeneration = 0;

function receive(state: DesktopUpdateState) {
  snapshot = state;
  revision += 1;
  for (const listener of listeners) listener();
}

function reportError(error: unknown) {
  receive({
    ...snapshot,
    status: "error",
    error:
      error instanceof Error ? error.message : "The update request failed.",
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const generation = ++subscriptionGeneration;
    disconnect = window.ajourDesktop?.onUpdateStateChanged?.(receive);
    const requestedRevision = revision;
    void window.ajourDesktop
      ?.getUpdateState?.()
      .then((state) => {
        // An event received while this snapshot was in flight is newer.
        if (
          generation === subscriptionGeneration &&
          revision === requestedRevision
        )
          receive(state);
      })
      .catch((error) => {
        if (
          generation === subscriptionGeneration &&
          revision === requestedRevision
        )
          reportError(error);
      });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscriptionGeneration += 1;
      disconnect?.();
      disconnect = undefined;
    }
  };
}

export function useDesktopUpdates() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export async function checkDesktopUpdates(track: UpdateTrack) {
  try {
    await window.ajourDesktop?.checkForUpdates?.(track);
  } catch (error) {
    reportError(error);
  }
}

export async function applyDesktopUpdate(state: DesktopUpdateState) {
  if (!state.result?.updateAvailable) return;
  try {
    if (state.canInstall && state.result.latestVersion) {
      await window.ajourDesktop?.updateAndRestart?.(
        state.result.track,
        state.result.latestVersion,
      );
    } else if (state.result.releaseUrl) {
      await window.ajourDesktop?.openUpdateRelease?.(state.result.releaseUrl);
    }
  } catch (error) {
    reportError(error);
  }
}

export function isDesktopUpdateBusy(state: DesktopUpdateState) {
  return ["checking", "confirming", "downloading", "installing"].includes(
    state.status,
  );
}

export function desktopUpdateLabel(state: DesktopUpdateState) {
  switch (state.status) {
    case "checking":
      return "Checking for updates";
    case "confirming":
      return "Waiting for update confirmation";
    case "downloading":
      return `Downloading Ajour update, ${state.progress ?? 0}%`;
    case "installing":
      return "Restarting Ajour to install update";
    case "error":
      return `${state.error} Check for updates again`;
    case "up-to-date":
      if (state.result && !state.result.latestVersion)
        return `No ${state.track} release has been published yet. Check for updates again`;
      return "Ajour is up to date. Check for updates again";
    case "available":
      return state.canInstall
        ? `Update to Ajour ${state.result?.latestVersion}`
        : `Ajour ${state.result?.latestVersion} is available. View release`;
    default:
      return "Check for updates";
  }
}
