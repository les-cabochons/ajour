# Sync review

Sync review is where items from backlog plugins wait for your decision before they enter your backlog. It is also where Ajour asks you to resolve description and estimate conflicts.

<Shot name="settings-sync-review" alt="Settings › Sync review with three staged Azure DevOps items" />

Open **Settings › Sync review**.

## Pick items to import

When you press **Sync** on a connection, the items it finds wait here, grouped by connection. Subitems show under their parent.

1. Check the items you want, or press **Select all** or **Select connection**.
2. Press **Sync selected to backlog**.

The other items stay staged. Press **Dismiss selected** or **Dismiss connection** to hide items you never want. A dismissed item does not come back at the next sync. **Undo** in the toast brings it back.

A parent marked **Context parent** is not yours to import. It is there so its subitems keep their context.

Items already in your backlog show **Existing task**, and **Update existing task** once checked. Importing them again updates them.

::: tip Skip the review
Turn on **Auto sync to backlog** on a connection to add new items straight to your backlog on a timer. See [Plugins](/plugins/#add-a-connection).
:::

## Resolve description conflicts

A synced item's description is kept in step with its source when the backlog plugin sends it in full. Ajour remembers the text both sides last agreed on. At each sync, a change in the source comes to Ajour, and your own edit stays. If both changed, the conflict shows here, with your text and the source's side by side.

- **Keep mine** writes your text to the source, when the backlog plugin writes descriptions. If the source changed again since, the conflict stays with its new text.
- **Take source** replaces your text with the source's. **Undo** in the toast puts yours back.

When a sync finds a description conflict, a toast says so, with **Resolve**. The item also shows a conflict mark on its row in the sidebar and the backlog, and beside its description. The mark and **Resolve** open Sync review on that item's conflict.

## Resolve estimate conflicts

Ajour remembers each estimate's value at the last sync. At the next sync:

- If you changed it in Ajour, the backlog plugin writes it to the source.
- If it changed in the source, Ajour takes the new value.
- If both changed, Ajour does not guess. The conflict shows here.

Each conflict shows the **Local**, **Remote** and **Last synced** values. Choose:

- **Keep local** to write your value to the source at the next sync.
- **Accept remote** to take the source's value.
- **Dismiss** to leave it for now.

A conflict on one estimate never blocks the other estimates of the item. A backlog item with a conflict shows the conflict mark on its row, which opens its conflicts here. Staged again here, it shows **Needs review**.

An estimate that failed to sync also shows here, with the plugin's message. Press **Dismiss** to clear it.
