const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Where a navigation from the Ajour window should go: "app" stays in the
 * window, "external" opens in the system browser, and "blocked" goes nowhere.
 *
 * The app is matched by protocol and host, not origin: Node gives app:// and
 * file:// URLs the same opaque origin. Only web and mail links leave the app,
 * as the renderer itself allows, so a link can never launch a local file or
 * another app's URL scheme. A URL that does not parse is blocked, not thrown.
 */
function classifyNavigation(url, appUrl) {
  let destination;
  let app;
  try {
    destination = new URL(url);
    app = new URL(appUrl);
  } catch {
    return "blocked";
  }

  if (destination.protocol === app.protocol && destination.host === app.host) {
    return "app";
  }

  return EXTERNAL_PROTOCOLS.has(destination.protocol) ? "external" : "blocked";
}

module.exports = {
  classifyNavigation,
};
