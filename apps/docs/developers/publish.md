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

The official plugins build it with `scripts/package-connector.mjs`. Copy it, with `scripts/connector-manifest.mjs`, from [ajc-jira](https://github.com/les-cabochons/ajc-jira/tree/main/scripts). It checks that:

- `plugin.json` passes Ajour's manifest rules, with `apiVersion` 3.
- `package.json` and `plugin.json` have the same version.
- The entry point is a compiled JavaScript file inside `dist/`.

It writes `package/<id>-<version>.ajour-connector`.

## Share a file

Send the archive. Users install it with **Settings › Plugins › Install from file**, in the desktop app. A plugin installed from a file starts active. Installing a newer file with the same `id` replaces the plugin and keeps its connections.

## Release on GitHub

For the catalog, publish each version as a GitHub release of your plugin's repository, with the archive attached:

- Tag the release with the version, such as `v0.1.0`.
- Attach exactly one archive that matches your catalog entry's `assetPattern`, such as `github_issues-0.1.0.ajour-connector`.

When a user presses **Download** or **Update**, Ajour lists the repository's last 30 releases, skips drafts, skips pre-releases unless your entry allows them, and installs the archive of the highest version.

The official plugins publish a pre-release from every push to `main`, with a version such as `1.0.0-main.12.f3e1b45`. Their workflow is [`.github/workflows/build.yml`](https://github.com/les-cabochons/ajc-jira/blob/main/.github/workflows/build.yml): it tests, stamps the version, packages, and runs `gh release create`.

## List it in the catalog

The catalog lives in [les-cabochons/ajour-plugins-index](https://github.com/les-cabochons/ajour-plugins-index). To add your plugin:

1. Fork the repository.
2. Add `plugins/<id>/plugin.yaml`. See [Catalog entry](/developers/catalog-entry).
3. Add the path to `catalog.yaml`.
4. Run `just validate`.
5. Open a pull request.

Once merged, Ajour picks up the entry at its next catalog refresh, every 15 minutes by default. You do not need to update the index for new versions. Ajour finds them in your releases.

## When the plugin API changes

A plugin works only with Ajour versions that use the same plugin API version. When Ajour moves to a new version:

1. Update your types and code, and set `apiVersion` in `plugin.json`.
2. Release the new version.
3. Update `compatibility.pluginApiVersion` in your catalog entry, so Ajour offers the update.
