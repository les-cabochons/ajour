# Install Ajour

Ajour is a desktop app for macOS and Windows. Download the installer for your machine from the [GitHub releases page](https://github.com/les-cabochons/ajour/releases).

| Platform              | File                        |
| --------------------- | --------------------------- |
| macOS (Apple silicon) | `Ajour-<version>-arm64.dmg` |
| macOS (Intel)         | `Ajour-<version>-x64.dmg`   |
| Windows               | `Ajour-<version>-x64.exe`   |

::: info Nightly builds only
Ajour has no stable release yet. Every release on the page is a nightly build, marked **Pre-release**. Take the newest one.
:::

::: warning Unsigned builds
The installers are not signed yet. macOS and Windows show a warning the first time you open Ajour.

On macOS, open the app once, then go to **System Settings › Privacy & Security** and press **Open Anyway**. On Windows, press **More info** in the SmartScreen dialog, then **Run anyway**.
:::

## Updates

Ajour checks GitHub for a newer version when you open **Settings › General**, or when you choose **Ajour › Check for updates…** in the menu bar. Pick the track in **Settings › General › Application updates**:

- **Stable**, the default, follows stable releases.
- **Nightly** follows the nightly builds.

Until the first stable release, choose **Nightly**, or Ajour never finds an update.

On Windows, Ajour also checks every 4 hours, and downloads the update in the background. When it is ready, Ajour asks you to restart now or later. If you choose later, the update installs when you next quit the app.

On macOS, Ajour shows that a new version is available, with a **View release** button. Download the new `.dmg` and replace the app. Automatic updates on macOS need a signed app, which Ajour does not have yet.

## The web version

The same app runs in a browser for development, with `just start` from the repository. It keeps its data in the browser and cannot run plugins or MCP. Use the desktop app for real work.
