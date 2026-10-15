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
  url: https://github.com/les-cabochons/ajc-azure-devops/blob/main/LICENSE
website: https://github.com/les-cabochons/ajc-azure-devops#readme
repository:
  provider: github
  slug: les-cabochons/ajc-azure-devops
  url: https://github.com/les-cabochons/ajc-azure-devops
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
  assetPattern: '^azure_devops-[0-9A-Za-z.+-]+\.ajour-connector$'
tags:
  - azure-devops
  - project-management
  - synchronization
```

## Fields

| Field                            | Rules                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                  | `2`.                                                                                                        |
| `id`                             | Lowercase letters, digits, `_` and `-`, 2 to 64 characters. Same as the folder name and your manifest `id`. |
| `title`                          | Up to 80 characters.                                                                                        |
| `description`                    | Up to 500 characters.                                                                                       |
| `author`                         | `name` and `url`.                                                                                           |
| `license`                        | `name`, `spdxId` and `url`.                                                                                 |
| `website`                        | A URL.                                                                                                      |
| `repository`                     | `provider: github`, `slug` such as `owner/repo`, and `url`, which must be `https://github.com/<slug>`.      |
| `status`                         | `available`, `coming-soon` or `deprecated`.                                                                 |
| `compatibility.pluginApiVersion` | The plugin API version of your latest release.                                                              |
| `capabilities`                   | 1 to 3 of `connector`, `codeHost` and `schema`.                                                             |
| `features`                       | 1 to 12 slugs, such as `work-item-sync`.                                                                    |
| `tags`                           | 1 to 12 slugs.                                                                                              |
| `install`                        | Required when `status` is `available`, refused for `coming-soon`. See below.                                |
| `images`                         | Optional thumbnail and hero image.                                                                          |

### install

| Field              | Rules                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `method`           | `github-release`.                                                                                             |
| `allowPrereleases` | Required. `true` to install pre-releases, `false` for full releases only.                                     |
| `assetPattern`     | A regular expression for the archive's file name, anchored with `^` and `$`. It must not match an empty name. |

Each release must have exactly one asset that matches `assetPattern`.

### images

Put image files next to `plugin.yaml`, as PNG, JPEG, WebP or AVIF, under 1 MB each:

- **Thumbnail**: square, at least 512 by 512 pixels.
- **Hero**: 16:9, at least 1600 by 900 pixels.

## Validate

Run `just validate` in the index repository before you open a pull request. CI runs the same check.
