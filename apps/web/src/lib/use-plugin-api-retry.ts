import { useEffect, useRef } from "react";

/**
 * Retries a app API read while the API is missing, because a page that
 * hides its plugin sections also hides their refresh controls. Retries when
 * the window regains focus or the network comes back, so an API started after
 * the page loaded shows up without a reload.
 */
export function useRetryWhilePluginApiMissing(
  pluginApiMissing: boolean,
  retry: () => unknown,
) {
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (!pluginApiMissing) {
      return;
    }

    const handleFocus = () => void retryRef.current();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void retryRef.current();
      }
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pluginApiMissing]);
}
