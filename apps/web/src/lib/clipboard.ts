/**
 * Writes text to the system clipboard. Uses the async Clipboard API, and falls
 * back to a hidden textarea with `execCommand("copy")` where that API is
 * missing or refused, such as an insecure origin.
 */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Reads the system clipboard's text, or undefined where the page may not read
 * it: the API is missing, or the browser or the user refused.
 */
export async function readTextFromClipboard(): Promise<string | undefined> {
  try {
    return await navigator.clipboard?.readText();
  } catch {
    return undefined;
  }
}
