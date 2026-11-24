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

Click a pull request for its review page. Under the title, a status line reads its state, its checks and its approvals, such as **Open · 2 checks pending · 1 approval**. Click the checks for each one and its state, and open it on its page; click the approvals for each reviewer's vote. The author's **Description** is folded away until you open it. Then come its changes, as a guide: the hunks grouped into concerns, numbered in reading order, each with a title and a one-line reason. Ajour builds the guide on your device, from the code, the way Review Deck does, with no agent. **Files A–Z** shows every changed file in path order instead, and **Guide** goes back. Long lines wrap. Ajour builds the diff itself from both versions of each file, the way Review Deck does, so a hunk is the same in both.

Mark a hunk **Viewed** to fold it. The guide tree on the right fills a tick per concern as you go; press <kbd>F</kbd> to see its titles, and click one to jump there. <kbd>J</kbd> and <kbd>K</kbd> go to the next and previous concern. Viewed marks last while the pull request stays open. Comment threads sit beside the lines they are on in a window 1,100 pixels wide or more, joined to them by a line, and right under their lines in a narrower one; a folded hunk folds its threads too. Point at a thread to highlight its line. The **Conversation** ends the page: the comments, reviews, commits and other events in time order, with the threads the diff no longer shows. The diff is read when you open the pull request: new commits show the next time you open it. **Open in GitHub**, or **Open in Azure DevOps**, takes you to it. Hold <kbd>⌘</kbd> and click a row to go there directly. Right-click a row, or press its **…** button, for the same actions.

## Ask for more detail

Each concern's reason ends with a faint **more ›**. Click it and the question it asks shows in place, ready: what the concern changes, why, and what to check. Press Enter to ask it as is, or type your own question first; Escape closes it. The answer is written in place under the reason by the agent you picked in **Settings › Agents**. It shows **Getting more detail…** until the answer starts, then the answer comes in as it is written, and ends with the commit it is about. Type in **Ask something else…** under an answer to ask another question about the concern. **Stop** stops an answer, and **Dismiss** closes it. An answer you already got, for the same question and commit, shows at once.

The first time you ask about a repository's pull request, Ajour asks once whether to send its code to that agent, and lists what leaves your computer: the changed lines, any other changed files the agent reads, and the review threads. Nothing is sent before you ask. **Settings › Agents › Questions about pull requests** lists the repositories you allowed, with **Revoke**, which also stops an answer being written for that repository. The agent reads only that pull request, at that commit, and none of your other Ajour data, so MCP doesn't need to be on. While a timesheet agent task runs, the answer waits for it to finish.

### Let answers read your clone

With your own clone of the repository, an answer can read the whole codebase at the pull request's latest commit, not only the changed files. Under an answer, click **Read your clone too**. Ajour lists the repository folders of your projects whose remote is that repository; pick one and click **Use clone**, or click **Choose a folder…** to pick another, a WSL folder included (through `\\wsl.localhost\…`). The question is asked again, and the answer then ends with **From the code at a41c9e2, and your clone**.

To get the pull request's commit, Ajour runs `git fetch` in your clone with your own Git sign-in, into references of its own, and checks it out in a separate folder it removes later. Your branches, staged changes and files stay as they are, and nothing runs in your clone. The agent only reads there, and sends what it reads to its provider. When Ajour can't read your clone, for example when the fetch fails, the answer comes from the pull request alone and says why under it. Codex reads files only through a shell, which Ajour keeps off, so its answers read the pull request alone. **Settings › Agents › Local clones** lists your clones, with **Forget**.

Press **Sync** to refresh the list now. Otherwise, each connection syncs on its interval while Ajour is open, unless you turned off its **Sync pull requests automatically**.

::: info Reviews happen in your code host for now
Deck shows a GitHub pull request's changes. Azure DevOps pull requests show their status line, description, threads and conversation, and their changes in a later version. Commenting and merging still happen on GitHub or Azure DevOps.
:::
