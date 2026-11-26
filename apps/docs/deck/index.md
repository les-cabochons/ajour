# Deck

Deck lists the pull requests that need you: the ones you wrote, and the ones you were asked to review. It brings them back to your plate when someone acts on them, so you do not have to watch your inbox.

<Shot name="deck" alt="Deck with active and settled pull requests" />

Deck needs a code host plugin, such as [GitHub](/plugins/github) or [Azure DevOps](/plugins/azure-devops). Once it is on, **Deck** shows in the sidebar's views, and in the toggle at the bottom of a [narrow window](/app/narrow-windows). While pull requests need you, a **Pull requests** section also shows in the sidebar. The plugin's switch for this part is still called **Pull requests**.

## What is on your plate

A pull request is active when it needs you. A new one starts active when your review is requested. Your own pull requests start settled, and come back when someone acts on them. Ajour decides from what happened on each one, and shows the reason:

| Reason                                    | When                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| **Review requested**                      | Someone asked you, or one of your teams, to review it.  |
| **New commits after your change request** | The author pushed after you requested changes.          |
| **New review**                            | Someone reviewed your pull request.                     |
| **New reply**                             | The author replied in a review thread you took part in. |
| **New comment**                           | Someone commented on your pull request.                 |
| **You were mentioned**                    | Someone mentioned you.                                  |
| **On your plate**                         | You unsettled it.                                       |

A pull request that came back shows **Returned** until you open it.

Deck lists pull requests in three sections: **Active**, **Settled**, and **Recently closed** for the last seven days.

## Settle and snooze

Pull requests settle and snooze like [backlog items](/backlog/settle-and-snooze):

- **Settle** (<kbd>E</kbd>) when you have done your part. The pull request comes back when someone acts on it again. **Unsettle** brings it back yourself.
- **Snooze** (<kbd>B</kbd>) to hide it until a time you pick. Turn on **Settings › General › Changes end a snooze early** to also bring it back when someone asks you to act.

Settling a pull request never writes to the code host.

## Open a pull request

Click a pull request for its review page. Under the title, a status line reads its state, its checks and its approvals, such as **Open · 2 checks pending · 1 approval**. Click the checks for each one and its state, and open it on its page; click the approvals for each reviewer's vote. The author's **Description** is folded away until you open it. Then come its changes, as a guide: the hunks grouped into concerns, numbered in reading order, each with a title and a one-line reason. Ajour builds the guide on your device, from the code, the way Review Deck does, with no agent. **Files A–Z** shows every changed file in path order instead, and **Guide** goes back. A pull request with more than 1,000 hunks shows its files A–Z, without a guide, since grouping that many would take too long. Long lines wrap. Ajour builds the diff itself from both versions of each file, the way Review Deck does, so a hunk is the same in both.

Mark a hunk **Viewed** to fold it. The guide tree on the right fills a tick per concern as you go; press <kbd>F</kbd> to see its titles, and click one to jump there. <kbd>J</kbd> and <kbd>K</kbd> go to the next and previous concern. Viewed marks last while the pull request stays open. Comment threads sit beside the lines they are on in a window 1,100 pixels wide or more, joined to them by a line, and right under their lines in a narrower one; a folded hunk folds its threads too. Point at a thread to highlight its line. The **Conversation** ends the page: the comments, reviews, commits and other events in time order, with the threads the diff no longer shows. Ajour keeps the pull requests it read on this computer, and after each sync reads the ones waiting on you, so they open at once. **Settings › Storage** shows how much Deck keeps, sets its size limit, and has **Clear cache**. **Open in GitHub**, or **Open in Azure DevOps**, takes you to it. Hold <kbd>⌘</kbd> and click a row to go there directly. Right-click a row, or press its **…** button, for the same actions.

## Changes since your review

Above the changes, the versions bar lists the pull request's **Pushes** on GitHub, or **Iterations** on Azure DevOps: **v1 · v2 · v3**, with a check after the one you last reviewed. Click them to see each one's commits. The page shows the latest version.

Coming back after new pushes, turn on **Changes since your review**: Deck keeps only the hunks that changed since the version you reviewed, and folds the concerns you don't need to read again into one line at the end. A hunk that a rebase only moved, with the same added and removed lines, counts as unchanged. Changed hunks say which version they changed in. The version you reviewed is the one you last approved, requested changes on or commented on, on GitHub or Azure DevOps, and Ajour remembers it on this computer.

When someone pushes while you read, a line above the bar says so, and the changes stay as they are until you press **Refresh**, so you don't lose your place.

## Comment and finish your review

Point at a line and click the **+** beside its number to comment on it, or drag from it to comment on several lines. **Add to review**, or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd> on a Mac), keeps the comment in your draft review, beside its line, marked **Draft**. **Comment now** posts it at once instead. A draft comment has **Edit** and **Remove**.

Your draft review is saved on your computer, so it survives closing Ajour, and nothing in it is sent before you finish. The header's **Finish review · 2** counts its comments. It opens a dialog with an optional summary and the verdict: **Comment**, **Request changes** (**Wait for author** on Azure DevOps, where the verdict is your vote) or **Approve**. From the keyboard, press <kbd>R</kbd> then <kbd>C</kbd>, <kbd>N</kbd> or <kbd>A</kbd> to open it on that verdict, or <kbd>R</kbd> then <kbd>Y</kbd> to approve at once, with no dialog.

The review goes to the code host as soon as you submit it. If it fails, your draft stays as it was, and the dialog says why, with **Retry**. Nothing waits to be sent later. Retry, also after you restart Ajour, doesn't post the review twice: Ajour names each review, and the plugin first looks on the code host for what an earlier try left there. Comments you post from a closed pull request's draft, and Comment now, work the same way. If someone edited the hidden name out of a review or comment on GitHub, the plugin can't be sure: Ajour says the review may already be there and asks you to check the pull request, then **Post again** posts it once more.

To comment from the keyboard, press <kbd>Tab</kbd> until a hunk's **Comment on line …** button shows, move it with <kbd>↑</kbd> and <kbd>↓</kbd>, and press <kbd>Enter</kbd>.

On Azure DevOps, where your vote counts for the whole pull request, Ajour won't approve once new commits arrived after you read it: open it again to read them first.

When the author pushes and you open the pull request again, a draft comment whose lines changed is marked **Outdated** and listed before the conversation. It isn't sent with the review; remove it when you're done with it. A pull request that closes keeps your draft, and stays under **Recently closed** until you post its comments with **Post as comments**, or **Discard** it.

Commenting and reviewing need the connection's **Review pull requests** access, and a token that can write to pull requests: **Code (Read & write)** on Azure DevOps. It starts off. Turn it on in the connection's settings under **Settings › Plugins**.

## Ask for more detail

Each concern's reason ends with a faint **more ›**. Click it and the question it asks shows in place, ready: what the concern changes, why, and what to check. Press Enter to ask it as is, or type your own question first; Escape closes it. The answer is written in place under the reason by the agent you picked in **Settings › Agents**. It shows **Getting more detail…** until the answer starts, then the answer comes in as it is written, and ends with the commit it is about. Type in **Ask something else…** under an answer to ask another question about the concern. **Stop** stops an answer, and **Dismiss** closes it. An answer you already got, for the same question and commit, shows at once.

The first time you ask about a repository's pull request, Ajour asks once whether to send its code to that agent, and lists what leaves your computer: the changed lines, any other changed files the agent reads, and the review threads. Nothing is sent before you ask. **Settings › Agents › Questions about pull requests** lists the repositories you allowed, with **Revoke**, which also stops an answer being written for that repository. The agent reads only that pull request, at that commit, and none of your other Ajour data, so MCP doesn't need to be on. While a timesheet agent task runs, the answer waits for it to finish.

### Let answers read your clone

With your own clone of the repository, an answer can read the whole codebase at the pull request's latest commit, not only the changed files. Under an answer, click **Read your clone too**. Ajour lists the repository folders of your projects whose remote is that repository; pick one and click **Use clone**, or click **Choose a folder…** to pick another, a WSL folder included (through `\\wsl.localhost\…`). The question is asked again, and the answer then ends with **From the code at a41c9e2, and your clone**.

To get the pull request's commit, Ajour runs `git fetch` in your clone with your own Git sign-in, into references of its own, and checks it out in a separate folder it removes later. Your branches, staged changes and files stay as they are, and nothing runs in your clone. The agent only reads there, and sends what it reads to its provider. When Ajour can't read your clone, for example when the fetch fails, the answer comes from the pull request alone and says why under it. Codex reads files only through a shell, which Ajour keeps off, so its answers read the pull request alone. **Settings › Agents › Local clones** lists your clones, with **Forget**.

Press **Sync** to refresh the list now. Otherwise, each connection syncs on its interval while Ajour is open, unless you turned off its **Sync pull requests automatically**.

::: info Merging happens in your code host for now
Deck shows the changes of GitHub and Azure DevOps pull requests. Replying to a thread and merging still happen on GitHub or Azure DevOps.
:::
