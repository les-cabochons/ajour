# Catalog entry

Each plugin in the catalog has a `plugins/<id>/plugin.yaml` file in [les-cabochons/ajour-plugins-index](https://github.com/les-cabochons/ajour-plugins-index). Ajour reads it to show the plugin in **Settings › Plugins** and to find its releases. Unknown keys are refused, and every link must use HTTPS.

## Example

```yaml
schemaVersion: 2
id: azure_devops
title: Azure DevOps
description: Sync Azure DevOps work items into Ajour's local backlog and update estimates from Ajour.
author:
  name: Alex Trépanier
  url: https://github.com/alextrepa
license:
  name: MIT License
  spdxId: MIT
  url: https://github.com/les-cabochons/ajour-plugins/blob/main/plugins/azure-devops/LICENSE
website: https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/azure-devops#readme
repository:
  provider: github
  slug: les-cabochons/ajour-plugins
  url: https://github.com/les-cabochons/ajour-plugins
status: available
compatibility:
  pluginApiVersion: 3
capabilities:
  - connector
features:
  - work-item-sync
  - estimate-update
install:
  method: github-release
  allowPrereleases: true
  assetPattern: '^azure_devops-[0-9][0-9A-Za-z.+-]*\.ajour-connector$'
tags:
  - azure-devops
  - project-management
  - synchronization
```

## Fields

| Field                            | Rules                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion`                  | `2`.                                                                                                                                       |
| `id`                             | Lowercase letters, digits, `_` and `-`, 2 to 64 characters. Same as the folder name and your manifest `id`.                                |
| `title`                          | Up to 80 characters.                                                                                                                       |
| `description`                    | Up to 500 characters.                                                                                                                      |
| `author`                         | `name` and `url`.                                                                                                                          |
| `license`                        | `name`, `spdxId` and `url`.                                                                                                                |
| `website`                        | A URL.                                                                                                                                     |
| `repository`                     | `provider: github`, `slug` such as `owner/repo`, and `url`, which must be `https://github.com/<slug>`.                                     |
| `status`                         | `available`, `coming-soon` or `deprecated`.                                                                                                |
| `compatibility.pluginApiVersion` | The plugin API version of your latest release.                                                                                             |
| `capabilities`                   | 1 to 3 of `connector`, `codeHost`, `calendar`, `team`, `agentTask` and `schema`. The backlog capability is `connector` until plugin API 4. |
| `features`                       | 1 to 12 slugs, such as `work-item-sync`. See below.                                                                                        |
| `tags`                           | 1 to 12 slugs.                                                                                                                             |
| `install`                        | Required when `status` is `available`, refused for `coming-soon`. See below.                                                               |
| `images`                         | Optional thumbnail and hero image.                                                                                                         |

### features

Ajour shows each feature with a title made from its slug and a line of text. It has its own text for `work-item-sync`, `estimate-update`, `pull-requests`, `calendar-events`, `project-sync` and `project-data-shape`. Any other slug gets a generic line, such as "Adds my feature support to Ajour." for `my-feature`.

### install

| Field              | Rules                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `method`           | `github-release`.                                                                                             |
| `allowPrereleases` | Required. `true` to install pre-releases, `false` for full releases only.                                     |
| `assetPattern`     | A regular expression for the archive's file name, anchored with `^` and `$`. It must not match an empty name. |

Each release must have exactly one asset that matches `assetPattern`. When several plugins publish from one repository, as the official ones do, a pattern must match only its own plugin's archives: start the version part with a digit, so that `^jira-[0-9]…` never matches a `jira-cloud-1.0.0` archive.

### images

Put image files next to `plugin.yaml`, as PNG, JPEG, WebP or AVIF, under 1 MB each:

- **Thumbnail**: square, at least 512 by 512 pixels.
- **Hero**: 16:9, at least 1600 by 900 pixels.

## Compatibility

Ajour skips an entry it cannot read, such as one that names a capability it does not know, and names it on the Plugins page. The rest of the catalog still shows. Ajour cannot install packaged schema plugins yet, so **Download** stays off for an entry whose only capability is `schema`.

## Validate

Run `just validate` in the index repository before you open a pull request. CI runs the same check.
