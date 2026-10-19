# Sync review

Sync review is where items from backlog plugins wait for your decision before they enter your backlog. It is also where Ajour asks you to resolve estimate conflicts.

<Shot name="settings-sync-review" alt="Settings › Sync review with three staged Azure DevOps items" />

Open **Settings › Sync review**.

## Pick items to import

When you press **Sync** on a connection, the items it finds wait here, grouped by connection. Subitems show under their parent.

1. Check the items you want, or press **Select all** or **Select connection**.
2. Press **Sync selected to backlog**.

The other items stay staged. Press **Dismiss selected** or **Dismiss connection** to hide items you never want. A dismissed item does not come back at the next sync.

A parent marked **Context parent** is not yours to import. It is there so its subitems keep their context.

Items already in your backlog show **Update existing task**. Importing them again updates them.

::: tip Skip the review
Turn on **Auto sync to backlog** on a connection to add new items straight to your backlog on a timer. See [Plugins](/plugins/#add-a-connection).
:::

## Resolve estimate conflicts

Ajour remembers each estimate's value at the last sync. At the next sync:

- If you changed it in Ajour, the backlog plugin writes it to the source.
- If it changed in the source, Ajour takes the new value.
- If both changed, Ajour does not guess. The conflict shows here.

Each conflict shows the **Local**, **Remote** and **Last synced** values. Choose:

- **Keep local** to write your value to the source at the next sync.
- **Accept remote** to take the source's value.
- **Dismiss** to leave it for now.

A conflict on one estimate never blocks the other estimates of the item. A backlog item with a conflict shows a warning on its row.
