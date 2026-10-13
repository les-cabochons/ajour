/** Accept source links from local records only when a browser can open them safely. */
export function openSourceUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
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
