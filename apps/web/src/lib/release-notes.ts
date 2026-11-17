import { useCallback, useEffect, useState } from "react";
import type { UpdateTrack } from "@/domain/local-state";
import {
  parseReleaseChanges,
  releaseLabel,
  type ReleaseChange,
} from "@/domain/release-notes";
import type { DesktopReleaseNote } from "@/lib/desktop-bridge";
import { traceCarrier } from "@/lib/wide-events";

/** Every release on GitHub, for the browser build and a failed read. */
export const ALL_RELEASES_URL =
  "https://github.com/les-cabochons/ajour/releases";

/** A release as What's new lists it. */
export interface Release {
  packageVersion: string;
  /** `Nightly 377`, or a stable version. */
  label: string;
  releaseUrl: string;
  publishedAt: string;
  changes: ReleaseChange[];
}

export type ReleaseNotesState =
  | { status: "loading" }
  | { status: "ready"; releases: Release[] }
  | { status: "error" }
  /** The browser build has no desktop app to read GitHub through. */
  | { status: "unavailable" };

export function releaseOf(note: DesktopReleaseNote): Release {
  return {
    packageVersion: note.packageVersion,
    label: releaseLabel(note.packageVersion),
    releaseUrl: note.releaseUrl,
    publishedAt: note.publishedAt,
    changes: parseReleaseChanges(note.body),
  };
}

/**
 * The latest releases of `track`, read through the desktop app, which caches
 * them for five minutes. `retry` reads again after a failure.
 */
export function useReleaseNotes(track: UpdateTrack) {
  const read = window.ajourDesktop?.getReleaseNotes;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReleaseNotesState>(
    read ? { status: "loading" } : { status: "unavailable" },
  );

  useEffect(() => {
    if (!read) return;
    let current = true;
    setState({ status: "loading" });
    read(track, traceCarrier()).then(
      (notes) => {
        if (current)
          setState({ status: "ready", releases: notes.map(releaseOf) });
      },
      () => {
        if (current) setState({ status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [read, track, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [state, retry] as const;
}
