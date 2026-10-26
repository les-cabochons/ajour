# Publish a plugin

Users can install your plugin two ways: from a file you give them, or from the catalog in **Settings › Plugins**. The catalog downloads releases from your plugin's GitHub repository.

## Package format

A plugin package is a `.ajour-connector` file: a gzip tar archive with `plugin.json` and the `dist/` folder at its root.

```text
github_issues-0.1.0.ajour-connector
  plugin.json
  dist/
    package.json      {"type": "module"}
    plugin.js
```

The official plugins build it with `scripts/package-connector.mjs`. Copy it, with `scripts/connector-manifest.mjs`, from [the Jira plugin](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/jira/scripts). It checks that:

- `plugin.json` passes Ajour's manifest rules, with `apiVersion` 3. This copy accepts the backlog and code host capabilities only, so adapt it for others.
- `package.json` and `plugin.json` have the same version.
- The entry point is a compiled JavaScript file inside `dist/`.

It writes `package/<id>-<version>.ajour-connector`.

A plugin that runs no code, such as one with only agent tasks, packs `plugin.json` and its prompt files instead. See the [Workday (agent) script](https://github.com/les-cabochons/ajour-plugins/blob/main/plugins/workday-agent/scripts/package-connector.mjs).

## Share a file

Send the archive. Users install it with **Settings › Plugins › Install from file**, in the desktop app. A plugin installed from a file starts active, and one downloaded from the catalog starts off. Installing a newer file with the same `id` replaces the plugin and keeps its connections and whether it was on. A capability that the update adds starts off, if the plugin has more than one that the user can turn on and off.

## Release on GitHub

For the catalog, publish each version as a GitHub release of your plugin's repository, with the archive attached:

- Tag the release with the version, such as `v0.1.0`.
- Attach exactly one archive that matches your catalog entry's `assetPattern`, such as `github_issues-0.1.0.ajour-connector`.

When a user presses **Download**, or **Update** on a plugin built for an older API, Ajour reads the repository's releases, newest first, 100 at a time until a page holds a matching archive, skips drafts, skips pre-releases unless your entry allows them, and installs the archive of the highest version.

The official plugins share one repository and publish a pre-release from every push to `main` that changes the plugin, with a version such as `1.0.0-main.130.9aac30e`. The tag carries the plugin in its pre-release part, `v1.0.0-jira.main.130.9aac30e`, so it stays unique and Ajour still reads it as a version. Their workflow is [`.github/workflows/build.yml`](https://github.com/les-cabochons/ajour-plugins/blob/main/.github/workflows/build.yml): it tests, stamps the version, packages, and runs `gh release create`.

## List it in the catalog

The catalog lives in [les-cabochons/ajour-plugins-index](https://github.com/les-cabochons/ajour-plugins-index). To add your plugin:

1. Fork the repository.
2. Add `plugins/<id>/plugin.yaml`. See [Catalog entry](/developers/catalog-entry).
3. Add the path to `catalog.yaml`.
4. Run `just validate`.
5. Open a pull request.

Once merged, Ajour picks up the entry at its next catalog refresh, every 15 minutes by default. You do not need to update the index for new versions: **Download** always takes your newest release. Users who already installed your plugin do not get new versions from the catalog, though. Tell them to install the new archive with **Install from file**.

## When the plugin API changes

A plugin works only with Ajour versions that use the same plugin API version. When Ajour moves to a new version:

1. Update your types and code, and set `apiVersion` in `plugin.json`.
2. Release the new version.
3. Update `compatibility.pluginApiVersion` in your catalog entry, so Ajour offers the update.
