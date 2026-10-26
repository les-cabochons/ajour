# Publish a plugin

Users can install your plugin two ways: from your [plugin source](/developers/plugin-source), a repository they add in **Settings › Plugins**, or from a file you give them. Both install the same files. A plugin from a source you sign is **signed**; any other is **unsigned**, and installing it needs **Allow installing unsigned plugins**, with a warning each time.

## Publish from a repository

Your repository needs an `ajour.json` at its root that lists your plugins. The official plugins keep their tooling in one file with no dependencies, [`scripts/ajour-source.mjs`](https://github.com/les-cabochons/ajour-plugins/blob/main/scripts/ajour-source.mjs). Copy it, then:

1. Create your signing key once, outside the repository:

   ```sh
   node scripts/ajour-source.mjs keygen
   ```

   It asks for a passphrase and writes an encrypted key to `~/.ajour/signing-key.json`. Keep that file out of cloud-synced folders, and use a long passphrase. It prints your key's fingerprint: publish it in your README so people can check it when they add your source.

2. Commit and push your plugin's changes, with a new `version` in `plugin.json` for every plugin that changed.

3. Write and sign the listing:

   ```sh
   node scripts/ajour-source.mjs release
   ```

   It pins every plugin to the commit you just pushed, hashes its files, writes `ajour.json` and signs it into `ajour.json.sig`. It refuses a plugin whose files changed while its version didn't.

4. Commit `ajour.json` and `ajour.json.sig`, and push.

Ajour picks up the new versions at its next refresh, every 15 minutes by default, and offers **Update** to people who have your plugin.

Pass `--unsigned` to `release` to publish without a signature. Your plugins then install only for people who allowed unsigned plugins, after a warning each time.

## Share a file

For testing, or for people who don't add your source, build an archive:

```sh
node scripts/ajour-source.mjs package <folder>
```

It writes `package/<id>-<version>.ajour-connector`: a gzip tar archive of the files your plugin lists, with `plugin.json` at its root. Users install it with **Install from file**, once they allowed unsigned plugins. A plugin installed from a file starts active, and one downloaded from a source starts off. Installing a newer file with the same `id` replaces the plugin and keeps its connections and whether it was on. A capability that the update adds starts off, if the plugin has more than one that the user can turn on and off.

## When the plugin API changes

A plugin works only with Ajour versions that use the same plugin API version. When Ajour moves to a new version:

1. Update your types and code, and set `apiVersion` in `plugin.json`.
2. Release a new version. `pluginApiVersion` in `ajour.json` follows `plugin.json`, and Ajour offers the update once the person runs a version of Ajour that uses it.
