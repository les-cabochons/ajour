/**
 * A source link from a local record, when a browser can open it safely: http
 * or https only, so a plugin's `javascript:` link never becomes an `href`.
 */
export function safeSourceUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Opens a source link in the browser; false when it isn't safe to open. */
export function openSourceUrl(value: string | undefined) {
  const url = safeSourceUrl(value);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export function openModifiedSourceClick(
  event: {
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  url: string | undefined,
) {
  if (!(event.ctrlKey || event.metaKey) || !url) return false;
  if (!openSourceUrl(url)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
