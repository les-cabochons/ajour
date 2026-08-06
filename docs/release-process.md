# Desktop Release Process

HarDay publishes Windows and macOS desktop distributables through two GitHub Actions workflows. Linux packaging is not part of the release matrix yet.

## Nightly releases

Every push to `main` runs **Desktop Nightly Release**. The workflow:

1. reads the release series from `VERSION` and existing release tags;
2. creates a SemVer-compatible `America/Toronto`-dated tag such as `v0.0.1-nightly.20260804.10`;
3. increments one global build counter across all dates and version series, so the build after `.002` is always `.003`;
4. builds Windows x64 NSIS and macOS x64/arm64 DMG and ZIP distributables with update metadata and blockmaps;
5. creates a GitHub prerelease with generated changelog notes and attaches all distributable files.

The nightly workflow tests the version planner, then reserves its tag with an atomic Git push before packaging. Simultaneous pushes retry against the newly fetched tags, so each push gets a distinct global build number instead of being cancelled by a workflow concurrency queue. A rerun reuses the tag already reserved for that commit. Release-series selection uses only `VERSION` and published release tags reachable from that commit; tags on later commits cannot change an older queued build.

The global counter is not zero-padded because numeric SemVer prerelease identifiers cannot contain leading zeroes. The Git tag and packaged application therefore share the same version, such as `v0.0.1-nightly.20260804.10` and `0.0.1-nightly.20260804.10`. Existing `vX.Y.Z-nightly-YYYYMMDD.NNN` releases remain readable for version history, but only the new format is emitted and eligible for stable promotion.

Each release exposes only artifacts for supported platforms:

- `HarDay-<version>-x64.exe` and its blockmap for Windows;
- `HarDay-<version>-x64.dmg` / `.zip` and `HarDay-<version>-arm64.dmg` / `.zip`, with blockmaps, for macOS;
- `latest.yml` and `latest-mac.yml` for stable updates, or `nightly.yml` and `nightly-mac.yml` for nightly updates.

HarDay uses Electron Builder's NSIS updater target. Squirrel `.nupkg` packages and `RELEASES` manifests are no longer generated or published.

## Stable releases

Run **Desktop Stable Release** manually from the Actions page, select the `main` branch, and enter the exact prior nightly tag to promote, such as `v0.0.1-nightly.20260804.10`. GitHub Actions does not support dynamically populated `workflow_dispatch` choices, so the tag is a required text field rather than a live dropdown. The workflow validates that the tag is a published nightly prerelease on `main`, reads the release-series baseline from that snapshot, creates the stable tag on that exact commit, and rebuilds it for macOS and Windows with the stable package version.

The first stable release uses the selected snapshot's `VERSION` value. Later stable releases inspect commits from the latest published stable release through the selected nightly only:

- one or more Conventional Commit `feat:` entries increment the minor version;
- other commits increment the patch version;
- a `type!:` header or `BREAKING CHANGE:` footer stops the workflow because major releases are deliberate operations.

To start a future major series, change `VERSION` to the intended `X.0.0` value in a reviewed commit before manually running the stable workflow. Until then, `VERSION` remains `0.0.1` and stable automation changes only minor and patch numbers.

Nightly and stable tags are reserved before packaging so reruns can recover without silently skipping a version; their GitHub releases are published only after both platform builds succeed. Changelog and stable-bump baselines use published, non-draft releases rather than reservation tags. If a stable tag is stranded on another commit, promotion stops and requires that pending reservation to be recovered or removed instead of silently advancing. Only the tag-planning and release jobs receive `contents: write`; packaging jobs run with read-only repository permissions and do not retain Git credentials. Repository Actions settings must allow the `GITHUB_TOKEN` to have read and write permissions.

The current macOS build is not production-signed or notarized, and the Windows installer is not code-signed. Users may therefore see operating-system trust warnings until signing and notarization credentials are added. macOS automatic installation requires a consistent Developer ID signature and notarization; the update artifacts are ready, but macOS updates must remain a manual download until those credentials are configured. Windows background updates work with the unsigned NSIS build, subject to the same Windows trust warnings as a manual install.

## In-app release checks

General Settings stores a local update-track preference. Stable is the default;
nightly is an explicit opt-in for preview builds. The renderer sends that one
validated preference to the desktop main process at startup; it does not receive
general network, updater, filesystem, or shell access.

On packaged Windows builds, the main process uses `electron-updater` to check
the matching GitHub channel at startup, after a track change, when the user
selects **Check again**, and every four hours while HarDay remains open.
Available updates download in the background. Once a download is verified,
HarDay asks whether to restart now or later. **Restart now** shuts down the
internal connector API before handing off to the installer. **Later** leaves
the update pending and installs it on the next normal app quit. macOS continues
to use the renderer-safe release check and manual release link until its builds
are signed and notarized.

Downloads are owned by the selected track rather than Electron's global
install-on-quit handler. Switching tracks cancels an active download, invalidates
an already downloaded update, and starts a fresh check for the newly selected
track. Nightly selection permits the SemVer downgrade needed to move from a
stable build to a prerelease with the same version core, but rejects nightlies
whose major, minor, or patch core is older than the installed build.

Stable checks use GitHub's latest full-release endpoint so a long nightly history
cannot hide the current stable build. Nightly checks inspect a bounded release
page but select by the parsed release version and global build number rather than
publication time, because concurrent packaging jobs can finish out of order.
Cross-track comparisons look up the installed release tag when publication order
is needed, and every GitHub request has a bounded timeout. The desktop process
coalesces concurrent checks for the same track and installed version, caches
successful results for five minutes, and applies a 30-second retry backoff after
a failed check.

The existing renderer-safe GitHub comparison remains responsible for the status
shown in General Settings and the optional release-page link. It uses the same
track as the automatic updater but returns only display metadata. If a track has
no published release yet, Settings reports that as an empty track rather than a
network failure.

The first release after the Squirrel-to-NSIS migration still requires one manual
installation because older HarDay builds do not contain the updater. Subsequent
NSIS installations can update automatically.
