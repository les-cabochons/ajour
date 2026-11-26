# GitHub

The GitHub plugin brings your open pull requests into Ajour: the ones you wrote, and the ones you were asked to review. Ajour then tracks which ones need you. See [Deck](/deck/). It also syncs the issues assigned to you into your backlog. See [Issues](#issues).

<Shot name="deck" alt="Pull requests from GitHub in Deck" />

## Set up

1. [Install the plugin](/plugins/#install-a-plugin) from **Settings › Plugins**, and turn it on.
2. Create a GitHub personal access token in **Settings › Developer settings › Personal access tokens**:
   - **Fine-grained token**: read access to pull requests, and read access to contents, on the repositories you want. To comment and submit reviews from [Deck](/deck/#comment-and-finish-your-review), make pull requests read and write, and turn on the connection's **Review pull requests** access. Plugin 0.7.0 adds that access, off, and asks you to allow the update. From plugin 0.9.0 it also covers replying to threads, resolving them, and marking files viewed on GitHub once you've viewed all their hunks in Deck. To [merge your own pull requests](/deck/#land-your-own-pull-request) from Deck, also make contents read and write (plugin 0.13.0). Add organization members read access to see review requests sent to your teams. For issues, add read and write access to issues.
   - **Classic token**: the `repo` and `read:org` scopes.
3. In Ajour, open the plugin, turn it on if it is off, and press **Add a connection**. Fill in the fields below, and press **Add connection**.

**Deck** then shows in the sidebar's views. Pull requests sync every 5 minutes while Ajour is open. Change it with **Sync interval (minutes)**, or turn off **Sync pull requests automatically**.

## Connection fields

| Field                                         | What to enter                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Connection label**                          | A name for this connection, such as `Work`.                                                                          |
| **Account**                                   | Which account this is, such as `Acme on GitHub`.                                                                     |
| **GitHub URL**                                | `https://github.com`, or your GitHub Enterprise Server URL.                                                          |
| **Personal access token**                     | The token from step 2. Ajour never shows it again.                                                                   |
| **Only these organizations or repositories**  | Optional, comma-separated, for issues and pull requests. `acme` is an organization or user, `acme/api` a repository. |
| **Never these organizations or repositories** | Optional, same format.                                                                                               |
| **Hide drafts**                               | Pull requests only. Leave out draft pull requests. Off by default.                                                   |
| **Include team review requests**              | Pull requests only. Include reviews requested from your teams. On by default. Needs the `read:org` permission.       |
| **Auto sync to backlog**                      | Issues only. Add issues straight to the backlog instead of staging them for review. Off by default.                  |
| **Sync pull requests automatically**          | Pull requests only. On by default. Connections saved before this setting keep their previous automatic sync choice.  |
| **Sync interval (minutes)**                   | How often to sync, from 1 to 1440. Defaults to 5.                                                                    |

## What it syncs

The plugin searches open pull requests in three ways: the ones you wrote, the ones where your review is requested, and the ones you reviewed. A pull request that closes stays tracked until Ajour sees it closed, even if your filters would hide it.

For each pull request, Ajour gets the facts it needs to decide if it needs you: reviews, review requests, comments, mentions, checks and the last push. It does not store the text of comments or reviews.

When you open a pull request in [Deck](/deck/), the plugin reads its changed files, then each one at the commit its branch started from and at its head. Ajour builds the diff from them and keeps it in memory while the pull request is on screen. A file with a NUL byte, or over 5,000,000 characters, shows as not shown. It also reads the issues the pull request closes or is linked to, and the first one's title heads its summary. Needs GitHub plugin 0.6.0.

## Limits

- GitHub search returns at most 1,000 results. If your searches go over, the sync fails with a message. Narrow it with **Only these organizations or repositories**.
- Each pull request brings its last 100 reviews and comments.
- Deck reads at most 3,000 changed files of a pull request, GitHub's own limit.
- Comments, reviews and merges happen on GitHub.

## Issues

Press **Sync** on the connection: open issues assigned to you wait in [Sync review](/plugins/sync-review), or go straight to the backlog with **Auto sync to backlog**.

- Each issue brings its title, repository and description.
- When an issue closes on GitHub, Ajour archives it.
- When you settle an issue, Ajour can close it, as completed or as not planned, or reopen it.
- GitHub issues have no estimates or priorities, so Ajour writes none back.
- Comments stay on GitHub. The item page shows none for an issue.

To use only pull requests, turn off **Backlog items** under **Capabilities** on the plugin's page. If you had the plugin before it brought issues, the update added them turned off: turn on **Backlog items** there.

## Source

[plugins/github](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/github) in les-cabochons/ajour-plugins on GitHub, MIT license.
