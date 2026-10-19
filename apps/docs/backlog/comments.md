# Comments

A synced item shows its comments on its page, under the description, when its backlog plugin provides them. You can read them, post your own, mention people and react. Each change goes to the source tool. Manual items have no comments.

<Shot name="backlog-comments" alt="Comments on an item page, with the people picker open after @jo" />

Ajour reads the comments from the tool when you open the item and keeps them in memory for five minutes, so reopening the item within that time shows the same thread. It never stores their text. Comments need the desktop app.

## Read comments

The page shows the newest five comments, oldest first, with their count next to **Comments**. Press **Show earlier comments** to load 20 more at a time.

- A **New** line marks the first comment someone else posted since you last opened the item on this device.
- A comment changed after it was posted says **edited**.
- A comment that only some people can see says who, such as **Restricted to Developers**.

## Write a comment

Click **Leave a comment…** at the bottom of the thread. The field stays at the bottom of the window while you scroll. Write in Markdown, then press **Comment** or <kbd>⌘</kbd> <kbd>Enter</kbd>. The comment goes to the tool at once and joins the thread.

- What you type stays as a draft on this device until you send it or press **Discard**. <kbd>Esc</kbd> closes the field and keeps the draft.
- If sending fails, the text stays, with the reason, so you can send it again.
- Near the tool's length limit, a count shows how many characters you used.

## Mention someone

When the tool supports mentions, type **@** to open the people picker. A bare **@** lists the people the tool suggests, such as the people on the item. Type a name to search, first and last name included. Each person shows with their name and email.

| Key                                                                  | Action                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| <kbd>↑</kbd> or <kbd>↓</kbd>                                         | Move through the people.                                               |
| <kbd>Enter</kbd> or <kbd>Tab</kbd>                                   | Mention the highlighted person. A click does the same.                 |
| <kbd>Esc</kbd>                                                       | Close the picker and keep writing. Press it again to close the editor. |
| <kbd>Ctrl</kbd> <kbd>Space</kbd>                                     | Open the picker again for the **@** at the cursor.                     |
| <kbd>Alt</kbd> <kbd>I</kbd> or <kbd>Alt</kbd> <kbd>`</kbd>, on macOS | The same as <kbd>Ctrl</kbd> <kbd>Space</kbd>.                          |

The person shows as a chip, and the tool notifies them. **No one found** means the search found nobody by that name. Mentions also work when you edit a comment and in the [settle dialog](/backlog/settle-and-snooze#settle-an-item).

## Edit or delete a comment

On your own comments, **…** offers **Edit** and **Delete** when the tool allows them.

- **Edit** turns the comment into an editor. Press **Save** or <kbd>⌘</kbd> <kbd>Enter</kbd> to save it in the tool at once, or **Cancel**.
- **Delete** hides the comment at once, with an Undo toast. The tool deletes it when the toast closes, or at the next launch if you quit Ajour first.

## React to a comment

A comment's reactions show under it with their counts. Click one to add or remove yours, or use the smiley in the comment's header to add another. The tool decides which reactions it offers. Your reaction shows at once and goes back if the tool refuses it.

## Comments and settled items

- When you settle an item, the settle dialog can post a comment along with the change. See [Settle and snooze](/backlog/settle-and-snooze#settle-an-item).
- When someone else comments on a settled item, it comes back to your plate. See [Unsettle](/backlog/settle-and-snooze#unsettle).

Agents can read and post comments only where you allow it. See [Agents](/app/agents#comments).
