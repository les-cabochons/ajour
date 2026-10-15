# Pull requests

Ajour lists the pull requests that need you: the ones you wrote, and the ones you were asked to review. It brings them back to your plate when someone acts on them, so you do not have to watch your inbox.

<Shot name="pull-requests" alt="The Pull requests page with active and settled pull requests" />

Pull requests need a code host plugin, such as [GitHub](/plugins/github). Once it is connected, **Pull requests** shows in the sidebar's view switcher, and a **Pull requests** section shows in the sidebar.

## What is on your plate

A pull request is active when it needs you. Ajour decides from what happened on it, and shows the reason:

| Reason                                    | When                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| **Review requested**                      | Someone asked you, or one of your teams, to review it.  |
| **New commits after your change request** | The author pushed after you requested changes.          |
| **New review**                            | Someone reviewed your pull request.                     |
| **New reply**                             | The author replied in a review thread you took part in. |
| **New comment**                           | Someone commented on your pull request.                 |
| **You were mentioned**                    | Someone mentioned you.                                  |

The page lists pull requests in three sections: **Active**, **Settled**, and **Recently closed** for the last seven days.

## Settle and snooze

Pull requests settle and snooze like [backlog items](/backlog/settle-and-snooze):

- **Settle** (<kbd>E</kbd>) when you have done your part. The pull request comes back when someone acts on it again.
- **Snooze** (<kbd>B</kbd>) to hide it until a time you pick.

Settling a pull request never writes to GitHub.

## Open a pull request

Click a pull request for its state, author, checks and last update. **Open in GitHub** takes you to it. Press **Sync** to refresh the list now. Otherwise, the GitHub connection syncs on its timer, every 5 minutes while Ajour is open.

::: info Reviews happen on GitHub for now
Ajour lists pull requests and tracks what needs you. Reading the diff, commenting and merging still happen on GitHub.
:::
