# Settle and snooze

Your sidebar lists the items on your plate. Settle and snooze take items off it, for different reasons:

- **Settle** when there is nothing left for you to do, for now or for good. For example, you sent a pull request and wait for review.
- **Snooze** when you will come back to it later, at a time you know.

## Settle an item

Press **Settle** on the item, or focus it and press <kbd>E</kbd>.

- A **manual** item is archived.
- A **synced** item becomes **settled**. It leaves your plate but stays in the backlog, in the sidebar's **Settled** section.

Settling a synced item can also write a change to its source, such as moving the Azure DevOps work item to `Resolved` or lowering its priority. By default, **Settle** on a synced item opens the settle dialog so you can choose. Leave a field as it is to write nothing for it.

<Shot name="backlog-settle" alt="The settle dialog with a state and a priority" />

If you pick a done state, the button reads **Archive**, and the item is archived instead of settled.

::: info Writes wait for the Undo toast
Ajour does not write to Azure DevOps or Jira right away. It sends the change when the Undo toast closes, after 8 seconds. If you press **Undo**, nothing is written. If you quit Ajour first, it sends the change at the next launch.

If the write fails, Ajour restores the item and shows an error that stays until you dismiss it.
:::

### Settle rules

To skip the dialog, set a settle rule per source project in **Settings › Backlog › Settle rules**:

- **Ask**, the default, opens the settle dialog every time.
- **Apply** settles at once with a fixed state, a fixed priority, or both. Press <kbd>Shift</kbd> <kbd>E</kbd>, or hold <kbd>Shift</kbd> and press **Settle**, to open the dialog anyway.

Sync a connector before you set rules. The source projects appear after the first sync.

### Unsettle

A settled item comes back to your plate on its own when a sync shows a state or priority other than the ones it had when you settled it. Its page then says **Changed in the source since you settled it**. To bring it back yourself, press **Unsettle**.

## Snooze an item

Press **Snooze** on the item, or focus it and press <kbd>B</kbd>. Pick when it returns:

<Shot name="backlog-snooze" alt="The Snooze until dialog" />

- **In an hour** or **In 3 hours**.
- **This afternoon**, at 13:00, before noon only.
- **Tomorrow**, at 9:00.
- **Next week**, on Monday at 9:00.
- Any date and time.

A snoozed item moves to the sidebar's **Snoozed** section, with its return time. When the time comes, it returns to your plate with a dot until you open it. Press **Unsnooze** to bring it back early.

Turn on **Settings › General › Changes end a snooze early** to also bring a synced item back when its state or priority changes in the source.

Snoozing never writes to the source tool.
