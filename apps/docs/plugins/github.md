# GitHub

The GitHub plugin brings your open pull requests into Ajour: the ones you wrote, and the ones you were asked to review. Ajour then tracks which ones need you. See [Pull requests](/pull-requests/).

<Shot name="pull-requests" alt="Pull requests from GitHub in Ajour" />

## Set up

1. [Install the plugin](/plugins/#install-a-plugin) from **Settings › Plugins**, and turn it on.
2. Create a GitHub personal access token in **Settings › Developer settings › Personal access tokens**:
   - **Fine-grained token**: read and write access to pull requests, and read access to contents, on the repositories you want. Add organization members read access to see review requests sent to your teams.
   - **Classic token**: the `repo` and `read:org` scopes.
3. In Ajour, open the plugin and press **Add a connection**. Fill in the fields below, and press **Add connection**.

The connection syncs every 5 minutes while Ajour is open. **Pull requests** then shows in the sidebar.

## Connection fields

| Field                                         | What to enter                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Connection label**                          | A name for this connection, such as `Work`.                                                   |
| **Account**                                   | Which account this is, such as `Acme on GitHub`.                                              |
| **GitHub URL**                                | `https://github.com`, or your GitHub Enterprise Server URL.                                   |
| **Personal access token**                     | The token from step 2. Ajour never shows it again.                                            |
| **Only these organizations or repositories**  | Optional, comma-separated. `acme` is an organization or user, `acme/api` a repository.        |
| **Never these organizations or repositories** | Optional, same format.                                                                        |
| **Hide drafts**                               | Leave out draft pull requests. Off by default.                                                |
| **Include team review requests**              | Include reviews requested from your teams. On by default. Needs the `read:org` permission.    |
| **Sync automatically**                        | On by default.                                                                                |
| **Sync interval (minutes)**                   | Defaults to 5.                                                                                |

## What it syncs

The plugin searches open pull requests in three ways: the ones you wrote, the ones where your review is requested, and the ones you reviewed. A pull request that closes stays tracked until Ajour sees it closed, even if your filters would hide it.

For each pull request, Ajour gets the facts it needs to decide if it needs you: reviews, review requests, comments, mentions, checks and the last push. It does not store the text of comments or reviews.

## Limits

- GitHub search returns at most 1,000 results. If your searches go over, the sync fails with a message. Narrow it with **Only these organizations or repositories**.
- Each pull request brings its last 100 reviews and comments.
- This version lists pull requests only. Comments, reviews and merges happen on GitHub.

## Source

[les-cabochons/ajc-github](https://github.com/les-cabochons/ajc-github) on GitHub, MIT license.
