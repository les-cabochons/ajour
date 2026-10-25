# Plugins come from signed plugin sources

Ajour used to find plugins in one index, les-cabochons/ajour-plugins-index, and download each one from its GitHub releases. Only plugins the index listed showed up, a release had to be built and uploaded for every change, and Ajour trusted whatever the release held. Instead, any git repository with an `ajour.json` at its root is a **plugin source**. The person keeps a list of sources in Settings › Plugins; the official one, les-cabochons/ajour-plugins, is there by default and can be removed. `ajour.json` names each plugin, its version, the commit its files come from and the SHA-256 of every file, and `ajour.json.sig` signs those exact bytes with an Ed25519 key. Plugins ship as source: Node strips the TypeScript types when the worker imports the entrypoint, so publishing needs no build. The format is in [apps/docs/developers/plugin-source.md](../../apps/docs/developers/plugin-source.md).

What Ajour checks, and where:

- The desktop main process reads every source, verifies the signature, pins the key, downloads a plugin's files at the commit `ajour.json` names, and checks each file's hash before the installer sees it. The renderer never fetches a source or a plugin file.
- The official source's keys are built into Ajour. A third-party source is pinned to the key the person approved when they added it. A different key, a lost signature or one that doesn't match hides the source's plugins until the person approves it again.
- A plugin is **signed** when it came from a source whose signature verified with the pinned or official key. Everything else is **unsigned**: an unsigned source, a key not approved yet, an archive installed from a file, a development folder.
- Installing an unsigned plugin needs Allow installing unsigned plugins, off by default, and shows a warning in the main process every time, so no renderer can skip it. Deactivate unsigned plugins stops every unsigned plugin at once, in the local API, without uninstalling it.
- The local API records each plugin's origin at install: source, commit, key and whether it was signed. Update is offered when the plugin's own source lists a newer version.

## Considered options

- **Keep the central index.** Rejected. Every plugin waited for a pull request to the index, and the index vouched for nothing: it pointed at releases anyone with push access could replace.
- **Download built archives from GitHub releases.** Rejected. Releases differ on every host and are capped by GitHub's API rate limit, and a built archive is a different artifact from the source people review.
- **Commit built archives to the repository.** Rejected. It keeps a build step for plugin authors and puts binaries in git history, for no integrity a hash of the source files doesn't give.
- **File hashes without a signature.** Rejected. Anyone who can push to the repository can change the code and its hashes in one commit. The signing key never touches the host, so a stolen account or token alone can't publish.
- **Sign in CI with a secret.** Rejected for the official source. Whoever can change the workflow can get anything signed. The maintainer signs on their own machine with a passphrase-protected key.

## Consequences

- Publishing a plugin is a repository with an `ajour.json`, on GitHub, GitLab, Codeberg or another Gitea or Forgejo host. The official tooling, `scripts/ajour-source.mjs` in les-cabochons/ajour-plugins, is one dependency-free file other authors can copy.
- A leaked signing key needs push access to the repository as well. The maintainer keeps a second, offline key to rotate to, and an Ajour release can drop a compromised key from the official list.
- Plugin authors write erasable TypeScript only: no enums, namespaces or parameter properties, and type-only imports marked `import type`. A plugin keeps its `package.json` with `"type": "module"` next to its source, so Node loads it as ESM.
- Plugins installed before origins existed have none, so they count as unsigned until they are updated from a source.
- The old index stays readable for older Ajour versions. They keep installing the last releases it points at.
