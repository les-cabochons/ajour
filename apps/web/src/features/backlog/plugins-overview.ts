import { useEffect, useState } from "react";
import {
  getCachedPluginsOverview,
  getPluginsOverview,
  subscribePluginsOverview,
} from "@/lib/app-api";

/**
 * The plugins overview, kept current as plugins and connections change. Asks
 * for it when none is cached yet; null until it arrives.
 */
export function usePluginsOverview() {
  const [overview, setOverview] = useState(getCachedPluginsOverview);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePluginsOverview((next) => {
      if (active) setOverview(next);
    });
    if (!getCachedPluginsOverview()) {
      void getPluginsOverview()
        .then((next) => active && setOverview(next))
        .catch(() => undefined);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return overview;
}
