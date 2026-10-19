# Backlog comments are fetched when shown, written at once, and deleted after the Undo window

A synced backlog item's comments live in its source tool. Ajour fetches them when the backlog item page opens, holds them in renderer memory for a few minutes, and never writes their text to its store. Syncs carry only comment facts for settled items (id, author, time and whether it mentions the user, without the text), so a comment from someone else can return the item. Posting and editing a comment go to the source tool as soon as the user acts, as pull request writes do ([ADR 0002](0002-pull-request-writes-are-immediate.md)): a failure keeps the text and offers a retry, and nothing is queued for a later launch. Deleting hides the comment at once and sends the delete only when the Undo toast closes, through the mechanism of [ADR 0001](0001-connector-writes-after-undo-window.md), because nobody waits on a deletion and Ajour prefers Undo to a confirmation dialog. A comment that rides on another delayed write, such as one typed in the settle dialog or posted by an agent, waits for that write's Undo window too.

## Considered options

- **Import comments with each sync and store them on the item.** Rejected. Comments are other people's words, often a client's, the browser store is small, and no feature needs them offline.
- **Hold every comment write until the Undo toast closes.** Rejected for the same reason as in ADR 0002: a comment that appears seconds late confuses the people waiting on it.
- **Delete at once after a confirmation dialog.** Rejected. A delayed delete harms no one, and the UI rules prefer Undo.

## Consequences

- Comments need the desktop app and the network at the moment the user looks. Offline, the page says nothing about comments it saw earlier.
- Ajour keeps one "last seen" time per item, so the page can mark comments that arrived since the user last opened it.
- A file pasted into a comment stays on the machine until the comment is sent, so a discarded comment leaves nothing in the source tool.
- Image and file bytes never pass through plugin code. The plugin describes each fetch or upload, and Ajour moves the bytes through the credential broker under that plugin's allowlist.
- Agents see comments only when the user allows it on the connection, which is off by default ([ADR 0004](0004-mcp-sends-local-data-to-the-clients-model.md)).
