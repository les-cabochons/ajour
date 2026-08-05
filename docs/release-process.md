# Desktop Release Process

HarDay publishes Windows and macOS desktop distributables through two GitHub Actions workflows. Linux packaging is not part of the release matrix yet.

## Nightly releases

Every push to `main` runs **Desktop Nightly Release**. The workflow:

1. reads the release series from `VERSION` and existing release tags;
2. creates an `America/Toronto`-dated tag such as `v0.0.1-nightly-20260804.001`;
3. increments one global build counter across all dates and version series, so the build after `.002` is always `.003`;
4. builds the macOS DMG and Windows Squirrel distributables;
5. creates a GitHub prerelease with generated changelog notes and attaches all distributable files.

The nightly workflow tests the version planner, then reserves its tag with an atomic Git push before packaging. Simultaneous pushes retry against the newly fetched tags, so each push gets a distinct global build number instead of being cancelled by a workflow concurrency queue. A rerun reuses the tag already reserved for that commit. Release-series selection uses only `VERSION` and published release tags reachable from that commit; tags on later commits cannot change an older queued build.

The padded counter is kept in the Git tag as part of the release naming contract. Because a numeric SemVer prerelease identifier cannot contain leading zeroes, packaged nightly applications use the equivalent valid version `0.0.1-nightly-20260804-001` internally.

## Stable releases

Run **Desktop Stable Release** manually from the Actions page, select the `main` branch, and enter the exact prior nightly tag to promote, such as `v0.0.1-nightly-20260804.002`. GitHub Actions does not support dynamically populated `workflow_dispatch` choices, so the tag is a required text field rather than a live dropdown. The workflow validates that the tag is a published nightly prerelease on `main`, reads the release-series baseline from that snapshot, creates the stable tag on that exact commit, and rebuilds it for macOS and Windows with the stable package version.

The first stable release uses the selected snapshot's `VERSION` value. Later stable releases inspect commits from the latest published stable release through the selected nightly only:

- one or more Conventional Commit `feat:` entries increment the minor version;
- other commits increment the patch version;
- a `type!:` header or `BREAKING CHANGE:` footer stops the workflow because major releases are deliberate operations.

To start a future major series, change `VERSION` to the intended `X.0.0` value in a reviewed commit before manually running the stable workflow. Until then, `VERSION` remains `0.0.1` and stable automation changes only minor and patch numbers.

Nightly and stable tags are reserved before packaging so reruns can recover without silently skipping a version; their GitHub releases are published only after both platform builds succeed. Changelog and stable-bump baselines use published, non-draft releases rather than reservation tags. If a stable tag is stranded on another commit, promotion stops and requires that pending reservation to be recovered or removed instead of silently advancing. Only the tag-planning and release jobs receive `contents: write`; packaging jobs run with read-only repository permissions and do not retain Git credentials. Repository Actions settings must allow the `GITHUB_TOKEN` to have read and write permissions.

The current macOS build is ad-hoc signed and not notarized, and the Windows installer is not code-signed. Users may therefore see operating-system trust warnings until signing and notarization credentials are added.

## In-app release checks

General Settings stores a local update-track preference. Stable is the default;
nightly is an explicit opt-in for preview builds. The desktop main process checks
the public `les-cabochons/ajour` GitHub Releases API and returns only published
releases whose tag and prerelease flag match the selected track. The renderer
does not receive general network or shell access: the preload bridge exposes one
update-check command and one repository-scoped command for opening a release
page in the default browser.

Checks run when General Settings opens, when the track changes, and when the
user selects **Check again**. They do not download or install a release. If a
track has no published release yet, Settings reports that as an empty track
rather than a network failure.
