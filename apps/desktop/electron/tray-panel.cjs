const OPEN_RETRY_MS = 2_000;

/**
 * Owns the native child window. The app renderer owns its React tree and state.
 * `request` asks the owner to open the panel and returns false when there is
 * no owner to ask.
 */
function createTrayPanelController({
  platform,
  getBounds,
  getWorkArea,
  request,
  visibility,
  now = Date.now,
}) {
  let panel = null;
  // When the owner was asked to open the panel; null when nothing is pending.
  // An owner that never answers (no window yet, a reload) must not block the
  // next click forever, so a request older than OPEN_RETRY_MS is sent again.
  let requestedAt = null;
  let blurredAt = null;

  function show() {
    if (!panel || panel.isDestroyed()) return;
    if (platform !== "linux") {
      const anchor = getBounds();
      const area = getWorkArea(anchor);
      const width = Math.min(360, area.width - 16);
      const height = Math.min(680, area.height - 16);
      const below = anchor.y + anchor.height + 8;
      panel.setBounds({
        x: Math.round(
          Math.max(
            area.x + 8,
            Math.min(
              anchor.x + anchor.width - width,
              area.x + area.width - width - 8,
            ),
          ),
        ),
        y: Math.round(
          Math.max(
            area.y + 8,
            below + height <= area.y + area.height - 8
              ? below
              : anchor.y - height - 8,
          ),
        ),
        width,
        height,
      });
    }
    visibility(true);
    panel.show();
    panel.focus();
  }

  function hide() {
    requestedAt = null;
    if (!panel || panel.isDestroyed()) return;
    panel.hide();
    visibility(false);
  }

  return {
    toggle() {
      // Clicking the tray can blur its popup before the click arrives.
      if (blurredAt !== null && now() - blurredAt < 150) {
        blurredAt = null;
        return;
      }
      if (panel && !panel.isDestroyed()) {
        // Linux keeps a regular window that can sit behind others: a click
        // brings it forward, and only hides it when it is already in front.
        const inFront = platform !== "linux" || panel.isFocused();
        if (panel.isVisible() && inFront) hide();
        else show();
      } else if (requestedAt === null || now() - requestedAt >= OPEN_RETRY_MS) {
        requestedAt = request() === false ? null : now();
      }
    },
    attach(window) {
      panel = window;
      window.on("blur", () => {
        if (platform !== "linux") {
          blurredAt = now();
          hide();
        }
      });
      // Linux's framed window has a close button, and Alt+F4 reaches the
      // others: closing hides it so its draft survives. Quitting destroys
      // it, which skips this event.
      window.on("close", (event) => {
        event.preventDefault();
        hide();
      });
      window.on("closed", () => {
        if (panel === window) panel = null;
        requestedAt = null;
        visibility(false);
      });
    },
    ready() {
      requestedAt = null;
      show();
    },
    hide,
    destroy() {
      requestedAt = null;
      if (panel && !panel.isDestroyed()) panel.destroy();
      panel = null;
    },
  };
}

module.exports = { createTrayPanelController };
