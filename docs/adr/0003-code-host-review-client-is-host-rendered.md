# Ajour renders the review client; code host plugins only move data

Ajour includes a full pull request review experience: file tree, diff, comments, reviews, title and draft edits, and merge. The UI lives in the web app, built on Pierre Diffs and Pierre Trees. A code host plugin returns provider-neutral data and carries out writes, and it ships no UI. This keeps plugins in the existing stateless worker sandbox, gives GitHub and Azure DevOps the same review experience, and keeps the review screens under the UI rules. Ajour itself, not the plugin, decides when a pull request is unsettled, from the facts the plugin returns.

## Considered options

- **Plugins ship their own React views.** Rejected. That means running plugin code in the renderer, versioning a component API, and getting a different review screen for each provider.
- **Plugin reports "your turn" directly.** Rejected. The rule would differ by provider and could not be tested in Ajour.

## Consequences

- Plugin capabilities replace plugin kinds. One package can be a connector and a code host, and the catalog lists capabilities instead of a single type.
- Pull request content is too large for browser storage. The local API caches it on disk, with a size limit set by the user.

Partly superseded by ADR 0007: plugins move from the stateless worker sandbox to sandboxed renderers. Ajour still renders every screen.
