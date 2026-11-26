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

Click a pull request for its review page. Under the title, a status line reads its state, its checks and its approvals, such as **Open · 2 checks pending · 1 approval**. Click the checks for each one and its state, and open it on its page; click the approvals for each reviewer's vote.

The **Summary** comes next, so you rarely need the description. It starts with the problem the pull request fixes: the title of the first issue it closes or is linked to on GitHub, or of its linked work item on Azure DevOps, then each linked ticket and its state, which opens on the code host. Without one it says **No linked ticket**. Then come the kinds of change the files tell (Tests, Docs, Dependencies, Build), and, when there are any:

- **Risky areas**: migrations, auth and security, deletion, and locking and concurrency, with their files;
- **Tests**: each concern's test files, and the changed code no test in the pull request covers;
- **Leftovers** the pull request adds: TODO and FIXME lines, debug output, commented-out code and skipped tests.

Click a line to go to its first hunk. Ajour builds the summary with the guide, on your device, by rules, with no agent. Each concern shows its kinds under its title too.

The author's **Description** is folded away until you open it. Then come its changes, as a guide: the hunks grouped into concerns, numbered in reading order, each with a title and a one-line reason. Ajour builds the guide on your device, from the code, the way Review Deck does, with no agent. **Files A–Z** shows every changed file in path order instead, and **Guide** goes back. A pull request with more than 1,000 hunks shows its files A–Z, without a guide or a summary, since grouping that many would take too long. Long lines wrap. Ajour builds the diff itself from both versions of each file, the way Review Deck does, so a hunk is the same in both.

Mark a hunk **Viewed** to fold it. The guide tree on the right fills a tick per concern as you go; press <kbd>F</kbd> to see its titles, and click one to jump there. <kbd>J</kbd> and <kbd>K</kbd> go to the next and previous concern. In **Files A–Z**, each file has a **File viewed** mark, which marks all its hunks. Ajour keeps viewed marks on your computer, so you pick up where you stopped, also after closing Ajour. On GitHub, a file whose hunks are all viewed is marked viewed on GitHub too, and a file you marked viewed on GitHub shows viewed here; Azure DevOps doesn't share which files you viewed, so there the marks stay on your computer. Comment threads sit beside the lines they are on in a window 1,100 pixels wide or more, joined to them by a line, and right under their lines in a narrower one; a folded hunk folds its threads too. Point at a thread to highlight its line. The **Conversation** ends the page: the comments, reviews, commits and other events in time order, with the threads the diff no longer shows. Ajour keeps the pull requests it read on this computer, and after each sync reads the ones waiting on you, so they open at once. **Settings › Storage** shows how much Deck keeps, sets its size limit, and has **Clear cache**. **Open in GitHub**, or **Open in Azure DevOps**, takes you to it. Hold <kbd>⌘</kbd> and click a row to go there directly. Right-click a row, or press its **…** button, for the same actions.

## Stacks

When a pull request targets the branch of another one you see in Deck, they form a stack, reviewed bottom first. Under the status line, the stack strip shows the whole stack, such as **Stack 2 of 3 · main ← #479 ← #482 this ← #485**: click a number, or ‹ and ›, to open the layer below or above. The status line adds the merge order, such as **Merges after #479**.

Branch names match exactly, case included, except the usual trunk names such as `main`, in any case. A fork's branch never counts as the one below, and a pull request shows no stack when two open pull requests come from the branch it targets, or when branches target each other in a loop.

Press <kbd>L</kbd>, or click **Stack 2 of 3**, for the full stack with each layer's title and checks. In a [narrow window](/app/narrow-windows), the strip folds to **Stack 2/3**, which opens it.

When the layer below changed since this one was based on it, a quiet line says so, so you don't review against an old base. On Azure DevOps, **Restack in Review Deck** opens the pull request in [Review Deck](https://github.com/les-cabochons/review-deck), where you can rebase the stack. Ajour itself never rebases.

Deck's list keeps a stack's layers together, each with its place, such as **Stack 2/3**. After you send a review of a layer, the dialog offers **Next in stack**, the layer above.

## Changes since your review

Above the changes, the versions bar lists the pull request's **Pushes** on GitHub, or **Iterations** on Azure DevOps: **v1 · v2 · v3**, with a check after the one you last reviewed. Click them to see each one's commits. The page shows the latest version.

Coming back after new pushes, turn on **Changes since your review**: Deck keeps only the hunks that changed since the version you reviewed, and folds the concerns you don't need to read again into one line at the end. A hunk that a rebase only moved, with the same added and removed lines, counts as unchanged. Changed hunks say which version they changed in. The version you reviewed is the one you last approved, requested changes on or commented on, on GitHub or Azure DevOps, and Ajour remembers it on this computer.

When someone pushes while you read, a line above the bar says so, and the changes stay as they are until you press **Refresh**, so you don't lose your place. After a refresh, a hunk you marked viewed stays viewed if the push left its added and removed lines as they were, wherever it moved; a hunk the push changed is unmarked, so you read it again.

## Comment and finish your review

Point at a line and click the **+** beside its number to comment on it, or drag from it to comment on several lines. **Add to review**, or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd> on a Mac), keeps the comment in your draft review, beside its line, marked **Draft**. **Comment now** posts it at once instead. A draft comment has **Edit** and **Remove**.

Your draft review is saved on your computer, so it survives closing Ajour, and nothing in it is sent before you finish. The header's **Finish review · 2** counts its comments. It opens a dialog with an optional summary and the verdict: **Comment**, **Request changes** (**Wait for author** on Azure DevOps, where the verdict is your vote) or **Approve**. From the keyboard, press <kbd>R</kbd> then <kbd>C</kbd>, <kbd>N</kbd> or <kbd>A</kbd> to open it on that verdict, or <kbd>R</kbd> then <kbd>Y</kbd> to approve at once, with no dialog.

The review goes to the code host as soon as you submit it. If it fails, your draft stays as it was, and the dialog says why, with **Retry**. Nothing waits to be sent later. Retry, also after you restart Ajour, doesn't post the review twice: Ajour names each review, and the plugin first looks on the code host for what an earlier try left there. Comments you post from a closed pull request's draft, and Comment now, work the same way. If someone edited the hidden name out of a review or comment on GitHub, the plugin can't be sure: Ajour says the review may already be there and asks you to check the pull request, then **Post again** posts it once more.

To suggest a change on lines of the new code, press **Suggest change** in the comment: it adds a suggestion block holding those lines, for you to edit into what they should be. GitHub and Azure DevOps show it with a way for the author to apply it.

To comment from the keyboard, press <kbd>Tab</kbd> until a hunk's **Comment on line …** button shows, move it with <kbd>↑</kbd> and <kbd>↓</kbd>, and press <kbd>Enter</kbd>.

On Azure DevOps, where your vote counts for the whole pull request, Ajour won't approve once new commits arrived after you read it: open it again to read them first.

When the author pushes and you open the pull request again, a draft comment whose lines changed is marked **Outdated** and listed before the conversation. It isn't sent with the review; remove it when you're done with it. A pull request that closes keeps your draft, and stays under **Recently closed** until you post its comments with **Post as comments**, or **Discard** it.

Commenting, replying, resolving, reviewing and marking files viewed on the code host need the connection's **Review pull requests** access, and a token that can write to pull requests: **Code (Read & write)** on Azure DevOps. It starts off. Turn it on in the connection's settings under **Settings › Plugins**.

## Reply and resolve

Each thread has **Reply** and **Resolve**. A reply goes to the code host at once, with <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd> on a Mac) or its **Reply** button; it isn't part of your draft review. If it fails, your words stay with **Retry**, which doesn't post it twice. On Azure DevOps a reply carries no hidden name, so after an answer was lost Ajour can't tell whether the reply got there when you wrote in that thread since: it says the reply may already be there, and **Post again** posts it once more. **Resolve** resolves the thread at once, and **Unresolve** opens it again.

## Land your own pull request

On a pull request you opened, Deck lets you finish it without leaving Ajour. Each change goes to the code host at once.

- **Edit the title**: the pencil beside the title edits it in place. <kbd>Enter</kbd> saves it, <kbd>Esc</kbd> leaves it as it was. If saving fails, your words stay, with **Retry**.
- **Convert to draft** and **Ready for review** (**Mark as draft** and **Publish** on Azure DevOps) switch it between draft and ready.
- **Merge…** asks first. It names the head you read and the branch it merges into, offers only the merge methods the repository allows (on GitHub, also those the target branch's rules allow), and starts the commit title the way the code host would write it, which you can change. A rebase has no merge commit, so no title. If the merge fails, the dialog keeps your method and title and says why, with **Retry**; Retry never merges twice. While a newer push than the one on screen came in, or while the pull request is a draft, Merge waits: refresh to read the new push, or mark it ready. Azure DevOps can take a moment to complete a pull request: the button reads **Merging…** until the connection's next sync finishes. If the pull request is still open then, merge again to check on it: Ajour sends nothing twice, and says why when Azure DevOps stopped. Conflicting branches show as an error.

These need the connection's **Review pull requests** access too. The chat can't merge: only this page does.

## Ask for more detail

Each concern's reason ends with a faint **more ›**. Click it and the question it asks shows in place, ready: what the concern changes, why, and what to check. Press Enter to ask it as is, or type your own question first; Escape closes it. The answer is written in place under the reason by the agent you picked in **Settings › Agents**. It shows **Getting more detail…** until the answer starts, then the answer comes in as it is written, and ends with the commit it is about. Type in **Ask something else…** under an answer to ask another question about the concern. **Stop** stops an answer, and **Dismiss** closes it. An answer you already got, for the same question and commit, shows at once.

Each line of the summary ends with the same **more ›**, which asks about that line.

The first time you ask about a repository's pull request, Ajour asks once whether to send its code to that agent, and lists what leaves your computer: the changed lines, any other changed files the agent reads, the review threads, and for a regroup the pull request's description and linked tickets. A repository you allowed before Deck could regroup a guide asks again before its first regroup. Nothing is sent before you ask. **Settings › Agents › Questions about pull requests** lists the repositories you allowed, with **Revoke**, which also stops an answer being written for that repository. The agent reads only that pull request, at that commit, and none of your other Ajour data, so MCP doesn't need to be on. While a timesheet agent task runs, the answer waits for it to finish.

## Chat about the pull request

For anything the questions in place don't cover, open the chat: **Chat** at the top of the page, or <kbd>A</kbd>. It opens on the right, or over the whole window on a narrow one, and keeps the conversation while you close and open it again. Its header says which agent answers and what it reads: `#482 · Claude Code · PR`, and `PR + local clone` once you chose your clone. Type a message and press <kbd>Enter</kbd>; <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line, and **Stop** stops a reply. Under an answer in place, **Continue in chat** opens the chat with what the answer was about, a concern, a summary line or the lines you selected, as a chip above your message; its **×** removes it.

The chat can also do what you ask it to on the pull request, in your name: add a draft comment, post a comment, reply in a thread, resolve a thread, submit a review with a summary, regroup the guide, and, on a pull request you opened, rename it or switch it between draft and ready. Each one goes to the code host at once and shows in the chat as one line, such as **Commented on src/api.ts:12**, with **Open** to see it on the code host and **Delete** to remove a comment, a reply or a draft comment it added. A review it submits is a comment with a summary: it never approves or requests changes, so nothing written in a pull request can make it vote for you. That, and your draft comments, wait for **Finish review**. It replies to and resolves only this pull request's threads, and a comment it tries again after losing the code host's answer posts once. The chat never merges: only **Merge…** on the page does.

The chat sends what a question sends, so a repository you allowed for questions needs nothing more. A regroup you ask the chat for sends what **Regroup…** sends, the pull request's description and its linked tickets too, so it needs what Regroup asks for: until you allow it, the chat says that **Regroup…** asks you, and regroups nothing.

## Regroup the guide

When you'd group the changes another way, press **Regroup…** after the guide's label (in the **…** menu on a narrow window). A short instruction shows, ready to send as is, or type your own, such as "Put tests with what they test", and press Enter. The agent you picked in **Settings › Agents** regroups the changes into concerns and writes the summary's problem, breaking changes and risky areas; Ajour checks that every change is in exactly one concern before it shows the new guide. The label then reads **Grouped by Claude Code**, with **Built from the code** after it: click that to go back to the guide Ajour built. With no ticket linked, the agent infers the problem, and the summary says so.

### Let answers read your clone

With your own clone of the repository, an answer can read the whole codebase at the pull request's latest commit, not only the changed files. Under an answer, click **Read your clone too**. Ajour lists the repository folders of your projects whose remote is that repository; pick one and click **Use clone**, or click **Choose a folder…** to pick another, a WSL folder included (through `\\wsl.localhost\…`). The question is asked again, and the answer then ends with **From the code at a41c9e2, and your clone**.

To get the pull request's commit, Ajour runs `git fetch` in your clone with your own Git sign-in, into references of its own, and checks it out in a separate folder it removes later. Your branches, staged changes and files stay as they are, and nothing runs in your clone. The agent only reads there, and sends what it reads to its provider. When Ajour can't read your clone, for example when the fetch fails, the answer comes from the pull request alone and says why under it. Codex reads files only through a shell, which Ajour keeps off, so its answers read the pull request alone. **Settings › Agents › Local clones** lists your clones, with **Forget**.

Press **Sync** to refresh the list now. Otherwise, each connection syncs on its interval while Ajour is open, unless you turned off its **Sync pull requests automatically**.

::: info Merging happens in your code host for now
Deck shows the changes of GitHub and Azure DevOps pull requests, and you review them there. Merging still happens on GitHub or Azure DevOps.
:::
