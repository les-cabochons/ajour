# Install Ajour

Ajour is a desktop app for macOS and Windows. Download the installer for your machine from the [GitHub releases page](https://github.com/les-cabochons/ajour/releases).

| Platform              | File                        |
| --------------------- | --------------------------- |
| macOS (Apple silicon) | `Ajour-<version>-arm64.dmg` |
| macOS (Intel)         | `Ajour-<version>-x64.dmg`   |
| Windows               | `Ajour-<version>-x64.exe`   |

On macOS, open the `.dmg` and drag Ajour to **Applications**. On Windows, run the `.exe`. It installs Ajour for your user only, in `%LOCALAPPDATA%\Programs\ajour`, and opens it.

::: info Nightly builds only
Ajour has no stable release yet. Every release on the page is a nightly build, marked **Pre-release**. Take the newest one.
:::

::: warning Unsigned builds
The installers are not signed yet. macOS and Windows show a warning the first time you open Ajour.

On macOS, open the app once, then go to **System Settings › Privacy & Security** and press **Open Anyway**. On Windows, press **More info** in the SmartScreen dialog, then **Run anyway**.
:::

## Updates

Ajour checks GitHub for a newer version on startup, every 4 hours, and when you open **Settings › General**. To check now, click the arrow at the bottom right of the sidebar, or press **Check again** in **Settings › General › Application updates**. On macOS, you can also choose **Ajour › Check for updates…** in the menu bar. Checks never download an update.

Pick the track in **Settings › General › Application updates**:

- **Stable**, the default, follows stable releases.
- **Nightly** follows the nightly builds.

Until the first stable release, choose **Nightly**, or Ajour never finds an update.

When a version is available, the arrow at the bottom right of the sidebar stands out, and its tooltip names the version.

On Windows, click it, or press **Update and restart** in Settings, to open a warning. **Update and restart** downloads the version and restarts Ajour to install it. Save your work first. **Cancel** leaves the update available. Quitting the app never installs an update.

On macOS, click it, or press **View release** in Settings, to open the release page. Download the new `.dmg` and replace the app. Automatic updates on macOS need a signed app, which Ajour does not have yet.

## The web version

The same app runs in a browser for development, with `just start` from the repository. It keeps its data in the browser and cannot run plugins or MCP. Use the desktop app for real work.
