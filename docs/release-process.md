# Desktop Release Process

Ajour publishes Windows and macOS desktop distributables through two GitHub Actions workflows. Linux packaging is not part of the release matrix yet.

## Nightly releases

Every push to `main` runs **Desktop Nightly Release**, except a push that only changes the docs site (`apps/docs` and its workflow). The workflow:

1. reads the release series from `VERSION` and existing release tags;
2. creates a SemVer-compatible `America/Toronto`-dated tag such as `v0.0.1-nightly.20260804.10`;
3. increments one global build counter across all dates and version series, so the build after `.002` is always `.003`;
4. builds Windows x64 NSIS and macOS x64/arm64 DMG and ZIP distributables with update metadata and blockmaps;
5. creates a GitHub prerelease with generated changelog notes and attaches all distributable files.

The nightly workflow tests the version planner, then reserves its tag with an atomic Git push before packaging. Simultaneous pushes retry against the newly fetched tags, so each push gets a distinct global build number instead of being cancelled by a workflow concurrency queue. A rerun reuses the tag already reserved for that commit. Release-series selection uses only `VERSION` and published release tags reachable from that commit; tags on later commits cannot change an older queued build.

The global counter is not zero-padded because numeric SemVer prerelease identifiers cannot contain leading zeroes. The Git tag and packaged application therefore share the same version, such as `v0.0.1-nightly.20260804.10` and `0.0.1-nightly.20260804.10`. Existing `vX.Y.Z-nightly-YYYYMMDD.NNN` releases remain readable for version history, but only the new format is emitted and eligible for stable promotion.

Each release exposes only artifacts for supported platforms:

- `Ajour-<version>-x64.exe` and its blockmap for Windows;
- `Ajour-<version>-x64.dmg` / `.zip` and `Ajour-<version>-arm64.dmg` / `.zip`, with blockmaps, for macOS;
- `latest.yml` and `latest-mac.yml` for stable updates, or `nightly.yml` and `nightly-mac.yml` for nightly updates.

Ajour uses Electron Builder's NSIS updater target. Squirrel `.nupkg` packages and `RELEASES` manifests are no longer generated or published.

## Stable releases

Run **Desktop Stable Release** manually from the Actions page, select the `main` branch, and enter the exact prior nightly tag to promote, such as `v0.0.1-nightly.20260804.10`. GitHub Actions does not support dynamically populated `workflow_dispatch` choices, so the tag is a required text field rather than a live dropdown. The workflow validates that the tag is a published nightly prerelease on `main`, reads the release-series baseline from that snapshot, creates the stable tag on that exact commit, and rebuilds it for macOS and Windows with the stable package version.

The first stable release uses the selected snapshot's `VERSION` value. Later stable releases inspect commits from the latest published stable release through the selected nightly only:

- one or more Conventional Commit `feat:` entries increment the minor version;
- other commits increment the patch version;
- a `type!:` header or `BREAKING CHANGE:` footer stops the workflow because major releases are deliberate operations.

To start a future major series, change `VERSION` to the intended `X.0.0` value in a reviewed commit before manually running the stable workflow. Until then, `VERSION` remains `0.0.1` and stable automation changes only minor and patch numbers.

Nightly and stable tags are reserved before packaging so reruns can recover without silently skipping a version; their GitHub releases are published only after both platform builds succeed. Changelog and stable-bump baselines use published, non-draft releases rather than reservation tags. If a stable tag is stranded on another commit, promotion stops and requires that pending reservation to be recovered or removed instead of silently advancing. Only the tag-planning and release jobs receive `contents: write`; packaging jobs run with read-only repository permissions and do not retain Git credentials. Repository Actions settings must allow the `GITHUB_TOKEN` to have read and write permissions.

## macOS signing and notarization

Both release workflows sign macOS x64 and arm64 builds with a Developer ID
Application certificate and notarize them with Apple. Each app must pass
signature and stapled-ticket verification before its artifacts are uploaded.
Missing credentials fail the release rather than publishing an unsigned app.

The repository requires these Actions secrets:

- `CSC_LINK`: base64-encoded `.p12` containing the certificate and private key.
- `CSC_KEY_PASSWORD`: the `.p12` password.
- `APPLE_API_KEY_P8`: the notarization team API key's `.p8` contents.
- `APPLE_API_KEY_ID`: the API key ID.
- `APPLE_API_ISSUER`: the team's issuer ID.

The macOS packaging step sets `AJOUR_MAC_RELEASE=1`, requires these credentials,
and writes the API key to a restricted temporary file removed even after failure.
Only macOS packaging receives signing secrets. Local builds omit this flag,
keep ad hoc signing, skip notarization and offer manual updates.

Install the first signed macOS release manually. Older ad hoc builds have no
in-place updater enabled. Later signed releases offer Update and restart.
The Windows installer remains unsigned and may show operating-system trust warnings.

## In-app release checks

General Settings stores a local update-track preference. Stable is the default;
nightly is an explicit opt-in for preview builds. The renderer sends that one
validated preference to the desktop main process at startup; it does not receive
general network, updater, filesystem, or shell access.

On packaged Windows builds and signed macOS releases, the main process uses `electron-updater` to check
the matching GitHub channel at startup, after a track change, when the user
selects **Check again**, and every four hours while Ajour remains open.
An available update waits for the user to select **Update and restart** and
confirm the dialog. Ajour then downloads it, verifies it, shuts down the
internal app API and restarts to install it. Cancelling the dialog leaves the
update available without downloading it. Automatic downloads and installation
on quit are disabled. Unsigned local macOS builds use the renderer-safe release
check and manual release link.

Downloads are owned by the selected track rather than Electron's global
install-on-quit handler. Switching tracks cancels an active download and starts
a fresh check for the newly selected track. Once installation begins, Ajour
refuses track changes. Nightly selection permits the SemVer downgrade needed
to move from a stable build to a prerelease with the same version core, but rejects nightlies
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
installation because older Ajour builds do not contain the updater. Subsequent
NSIS installations can update automatically.
