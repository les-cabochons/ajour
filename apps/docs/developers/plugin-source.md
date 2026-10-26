# Plugin source

A plugin source is a git repository with an `ajour.json` file at its root. People add its address in **Settings › Plugins › Plugin sources**, and Ajour lists every plugin it names. The repository can live on GitHub, GitLab, Codeberg or another Gitea or Forgejo host.

Ajour reads `ajour.json` and `ajour.json.sig` from the default branch, then each plugin's files at the commit `ajour.json` names. It checks every file against its SHA-256 before it installs anything.

## Example

```json
{
  "schemaVersion": 1,
  "name": "Ajour official plugins",
  "plugins": [
    {
      "id": "jira",
      "name": "Jira",
      "description": "Sync Jira issues into Ajour's local backlog and update estimates from Ajour.",
      "version": "1.0.0",
      "pluginApiVersion": 3,
      "capabilities": ["connector"],
      "features": ["work-item-sync", "estimate-update"],
      "tags": ["jira", "project-management"],
      "author": {
        "name": "Alex Trépanier",
        "url": "https://github.com/alextrepa"
      },
      "license": { "name": "MIT License", "spdxId": "MIT" },
      "website": "https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/jira#readme",
      "status": "available",
      "commit": "888d80ba3fa8d53889011f03a5ab7848b0e06328",
      "path": "plugins/jira",
      "files": [
        { "path": "plugin.json", "sha256": "9f2c…", "size": 4096 },
        { "path": "package.json", "sha256": "41ab…", "size": 512 },
        { "path": "src/plugin.ts", "sha256": "c03e…", "size": 2048 }
      ]
    }
  ]
}
```

Don't write it by hand. The official plugins generate it with [`scripts/ajour-source.mjs`](https://github.com/les-cabochons/ajour-plugins/blob/main/scripts/ajour-source.mjs), one file with no dependencies that you can copy into your repository. See [Publish a plugin](/developers/publish).

## Fields

Unknown keys are refused, and every link must use HTTPS.

| Field           | Rules                                                |
| --------------- | ---------------------------------------------------- |
| `schemaVersion` | `1`.                                                 |
| `name`          | The source's name, 1 to 80 characters.               |
| `plugins`       | 1 to 100 entries, each with its own `id`. See below. |

Each plugin:

| Field              | Rules                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | Lowercase letters, digits, `_` and `-`, 2 to 64 characters. The same as `plugin.json`'s `id`.                                              |
| `name`             | 1 to 80 characters.                                                                                                                        |
| `description`      | 1 to 500 characters.                                                                                                                       |
| `version`          | The same as `plugin.json`'s `version`, such as `1.2.0` or `1.2.0-beta.1`. Ajour offers **Update** when it is newer than the installed one. |
| `pluginApiVersion` | The same as `plugin.json`'s `apiVersion`.                                                                                                  |
| `capabilities`     | 1 to 6 of `connector`, `codeHost`, `calendar`, `team`, `agentTask` and `schema`. The backlog capability is `connector`.                    |
| `features`         | 1 to 12 slugs, such as `work-item-sync`. See below.                                                                                        |
| `tags`             | 1 to 12 slugs.                                                                                                                             |
| `author`           | `name` and `url`.                                                                                                                          |
| `license`          | `name` and `spdxId`.                                                                                                                       |
| `website`          | Optional. A URL.                                                                                                                           |
| `status`           | `available`, `coming-soon` or `deprecated`.                                                                                                |
| `commit`           | The full commit ID the files come from, 40 or 64 lowercase hex characters.                                                                 |
| `path`             | The plugin's folder in the repository, such as `plugins/jira`, or `.` for the root.                                                        |
| `files`            | Required when `available`, refused when `coming-soon`. 1 to 500 files, `plugin.json` among them, 25 MiB at most together.                  |
| `images`           | Optional `thumbnail` and `hero`, each a file entry.                                                                                        |

A file entry has a `path` inside the plugin's folder, its `sha256` in lowercase hex, and its `size` in bytes. A path is relative, with `/` between plain segments of letters, digits, `.`, `_` and `-`: no `..`. Images are PNG, JPEG, WebP or AVIF, under 1 MB. Use a square thumbnail of at least 512 pixels and a 16:9 hero of at least 1600 by 900.

### features

Ajour shows each feature with a title made from its slug and a line of text. It has its own text for `work-item-sync`, `estimate-update`, `pull-requests`, `calendar-events`, `project-sync` and `project-data-shape`. Any other slug gets a generic line, such as "Adds my feature support to Ajour." for `my-feature`.

## Signature

`ajour.json.sig` signs the exact bytes of `ajour.json` with an Ed25519 key:

```json
{
  "schemaVersion": 1,
  "algorithm": "ed25519",
  "publicKey": "<base64 of the 32-byte public key>",
  "signature": "<base64 of the 64-byte signature>"
}
```

- When someone adds your source, Ajour shows the key's fingerprint, such as `3f2a 9c1d 77e0 b4a2`, and from then on trusts your source only with that key. Publish the fingerprint where people can check it, such as your README.
- If you sign with another key later, Ajour hides your plugins until each person approves the new key. Keep your key safe, and keep a second one offline in case you lose it.
- A source without `ajour.json.sig` is unsigned. People can still add it, but installing its plugins needs **Allow installing unsigned plugins**, and Ajour warns them each time.
- A source that was signed and loses its signature, or whose signature doesn't match, shows no plugins.

## Plugin files

Ajour installs exactly the files you list, at your commit, and runs your entrypoint where it is. It needs no build:

- The entrypoint can be TypeScript. Node strips the types, so write erasable TypeScript only: no `enum`, `namespace` or constructor parameter properties, and mark type-only imports with `import type`. Import your own files with their `.ts` extension. TypeScript's `erasableSyntaxOnly`, `verbatimModuleSyntax` and `allowImportingTsExtensions` options check all of it.
- On plugin API 4, the plugin runs in a sandboxed renderer with no Node: Ajour strips the types of each `.ts` or `.mts` file as the renderer loads it, with the same rules. A file it can't strip, or a `.ts` or `.mts` file over 2 MB, fails the run with a reason that names the file, and none of the plugin's code runs. The only thing the plugin's code can reach at runtime is the `ajour` global. See [the SDK's TypeScript rules](https://github.com/les-cabochons/ajour/blob/main/packages/plugin-sdk/README.md#typescript-source).
- List your `package.json`, with `"type": "module"`, so Node loads your files as ES modules.
- There is no `node_modules`. Copy a library you need into your folder, with its licence, and import it by its path.

## Validate

Before you push, run `node scripts/ajour-source.mjs verify` in your repository. It checks `ajour.json` against these rules, every file's hash at its commit, `plugin.json` against its entry, and the signature.
