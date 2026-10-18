# Synced text never overwrites richer source content

A synced backlog item's description is two-way synced, and the user's own comments can be edited, both as Markdown. Azure DevOps stores HTML and Jira stores ADF, and both can hold things Markdown cannot, such as colours, Jira panels and embedded media. The plugin converts the source's text to Markdown and reports what the conversion dropped. Ajour writes such lossy text back only when the user has allowed lossy conversion on that connection, off by default, and confirms in a dialog that names what will be lost. Otherwise the text is read-only in Ajour, with Edit in source. Images never count as lost: the plugin turns each one into a Markdown image whose address is an opaque reference holding everything the source needs to rebuild it, such as Jira's media id, collection and attachment id, and restores the original on write.

## Considered options

- **Write Ajour's Markdown back regardless.** Rejected. One edit in Ajour would erase a colleague's formatting, and in Jira a description written without its media nodes can lose its attachments.
- **Keep synced descriptions read-only.** Rejected. The user wants to edit them where they work.
- **Switch Azure DevOps descriptions to Markdown when Ajour writes them.** Rejected. The switch cannot be undone and changes the editor for everyone on the team. Ajour writes HTML back and keeps each item's format; comments, which have no format to preserve, go as Markdown.
- **Move descriptions out of the browser store.** Rejected for now as a bigger change than this needs.

## Consequences

- Ajour stores at most 64,000 characters of a description. A longer one is stored cut off and treated like lossy text: shown, never written back.
- Each plugin declares its source's length limits for descriptions and comments, measured the way the source measures them, and checks the converted size on write. A text that is too long is not sent and stays in the editor.
- Description sync follows the estimate model: Ajour keeps the last synced copy, and a description changed on both sides is a conflict for the user to resolve.
- The plugins need converters from Markdown back to each source's format: HTML for Azure DevOps and ADF for Jira.
