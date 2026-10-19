# Pull requests

Ajour lists the pull requests that need you: the ones you wrote, and the ones you were asked to review. It brings them back to your plate when someone acts on them, so you do not have to watch your inbox.

<Shot name="pull-requests" alt="The Pull requests page with active and settled pull requests" />

Pull requests need a code host plugin, such as [GitHub](/plugins/github) or [Azure DevOps](/plugins/azure-devops). Once it is on, **Pull requests** shows in the sidebar's view switcher. While pull requests need you, a **Pull requests** section also shows in the sidebar.

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

The page lists pull requests in three sections: **Active**, **Settled**, and **Recently closed** for the last seven days.

## Settle and snooze

Pull requests settle and snooze like [backlog items](/backlog/settle-and-snooze):

- **Settle** (<kbd>E</kbd>) when you have done your part. The pull request comes back when someone acts on it again. **Unsettle** brings it back yourself.
- **Snooze** (<kbd>B</kbd>) to hide it until a time you pick. Turn on **Settings › General › Changes end a snooze early** to also bring it back when someone asks you to act.

Settling a pull request never writes to the code host.

## Open a pull request

Click a pull request for its state, author, checks and last update. **Open in GitHub**, or **Open in Azure DevOps**, takes you to it. Hold <kbd>⌘</kbd> and click a row to go there directly. Right-click a row, or press its **…** button, for the same actions.

Press **Sync** to refresh the list now. Otherwise, each connection syncs on its interval while Ajour is open, unless you turned off its **Sync pull requests automatically**.

::: info Reviews happen in your code host for now
Ajour lists pull requests and tracks what needs you. Reading the diff, commenting and merging still happen on GitHub or Azure DevOps.
:::
