const WINDOWS_TITLE_BAR_HEIGHT = 48;

const WINDOWS_TITLE_BAR_THEMES = {
  dark: {
    color: "#00000000",
    symbolColor: "#fafafa",
    height: WINDOWS_TITLE_BAR_HEIGHT,
  },
  light: {
    color: "#00000000",
    symbolColor: "#252525",
    height: WINDOWS_TITLE_BAR_HEIGHT,
  },
};

function getWindowsTitleBarOverlay(theme) {
  const overlay = WINDOWS_TITLE_BAR_THEMES[theme];
  if (!overlay) {
    throw new TypeError(`Unsupported window chrome theme: ${theme}`);
  }

  return { ...overlay };
}

function getPlatformWindowChromeOptions(platform, theme) {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 16, y: 18 },
    };
  }

  if (platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: getWindowsTitleBarOverlay(theme),
    };
  }

  return {};
}

module.exports = {
  getPlatformWindowChromeOptions,
  getWindowsTitleBarOverlay,
};
