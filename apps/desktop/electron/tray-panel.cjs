/** Owns the native child window. The app renderer owns its React tree and state. */
function createTrayPanelController({
  platform,
  getBounds,
  getWorkArea,
  request,
  visibility,
  now = Date.now,
}) {
  let panel = null;
  let opening = false;
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
    opening = false;
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
        if (panel.isVisible()) hide();
        else show();
      } else if (!opening) {
        opening = true;
        request();
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
      window.on("closed", () => {
        if (panel === window) panel = null;
        opening = false;
        visibility(false);
      });
    },
    ready() {
      opening = false;
      show();
    },
    hide,
    destroy() {
      opening = false;
      if (panel && !panel.isDestroyed()) panel.destroy();
      panel = null;
    },
  };
}

module.exports = { createTrayPanelController };
