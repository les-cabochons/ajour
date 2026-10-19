# Calendar suggestions

With a calendar plugin on, the Time page shows the meetings in your calendar on their day. Add the ones you want as time entries, and dismiss the others. Nothing becomes an entry until you add it, and Ajour does not keep your calendar's events.

<Shot name="time-calendar-day" alt="The Day view with two meetings from the calendar under the day's entries" />

## Turn them on

Install a calendar plugin, such as [Calendar address (ICS)](/plugins/ics), then add a connection. The suggestions and **Settings › Calendar** appear once the connection is there.

A submitted week shows no suggestions.

## Where they show

- **Day view**: **From your calendar**, under the day's rows, lists the day's meetings. Each row has the time, the title, a project picker, the duration, **Add** and **Dismiss**.
- **Week Days**: each column shows its meetings as dashed cards under **From calendar**, below **+ Add**.
- **Week Grid**: a day's header shows a calendar chip with the number of meetings to add. Click it to open the Calendar panel on that day.
- **Calendar**, in the header of the Day and Week views, opens the Calendar panel. It shows the week's count, such as **Calendar · 4**.

<Shot name="time-calendar-week-days" alt="The Week Days layout with dashed calendar cards under each day's entries" />

## Add a meeting

Pick a project and task with **Choose project…**. Picking adds the meeting at once. For a recurring meeting, Ajour also remembers your choice and fills it in on the meeting's other days, so you only press **Add**.

The new entry lands on the meeting's day, with the meeting's duration and its title as the note. An Undo toast follows. If you delete the entry, the meeting shows again.

On a Week Days card, click the card to add it, or to pick its project first.

| Key                                       | Action                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| <kbd>Enter</kbd>                          | Add the focused meeting, once it has a project                                          |
| <kbd>Space</kbd>                          | On a Week Days card, add the meeting, or open its project picker when it has no project |
| <kbd>Backspace</kbd> or <kbd>Delete</kbd> | Dismiss the focused meeting                                                             |

## Add the week at once

The Calendar panel lists the week's meetings by day, each with a checkbox. Meetings with a project start checked. Uncheck the ones you skip, then press the add button, such as **Add 3 entries · 2:30**. **Dismiss** dismisses the checked meetings. Both come with one Undo.

<Shot name="time-calendar-panel" alt="The Calendar panel with the week's meetings by day and the add button" />

A meeting with no project has its checkbox greyed out. Pick its project in the panel to add it at once.

Press <kbd>Esc</kbd> or the close button to close the panel. Opening an entry in the side panel closes it too.

## Dismiss, hide or forget

Right-click a meeting, or press its **…** button, for these actions:

| Action                  | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| **Add**                 | Adds the meeting as an entry. Greyed out until it has a project.      |
| **Choose project…**     | Opens the project picker.                                             |
| **Dismiss**             | Hides this meeting on this day. Its other days still show.            |
| **Hide this meeting**   | Hides every day of a recurring meeting.                               |
| **Forget this meeting** | Stops filling in the project Ajour remembers for a recurring meeting. |

**Dismiss**, **Hide this meeting** and **Forget this meeting** each show an Undo toast. The last two apply to recurring meetings only. **Settings › Calendar › Remembered meetings** lists the meetings Ajour fills in and the ones you hid. Press **Remove** to choose again next time.

## Filtered events

**Settings › Calendar** hides some events from the suggestions:

| Setting                                 | Default                             |
| --------------------------------------- | ----------------------------------- |
| **Hide all-day events**                 | On                                  |
| **Hide meetings you declined**          | On                                  |
| **Hide events marked free**             | On                                  |
| **Hide meetings you have not answered** | Off                                 |
| **Hide events shorter than**            | 0 minutes, which shows every length |

The Day view counts the day's hidden events, such as `2 events hidden by your calendar settings.` Press **Show hidden** to list them, each with a chip that says why: **All day**, **Declined**, **Free**, **Not answered** or **Short**. You can add them like the others.

## Refresh

Ajour reads your calendar when you open a week, and again every 10 minutes while its window shows. Change the interval with **Refresh every** in **Settings › Calendar**. To read it now, press the refresh button, **Refresh calendar**, in **From your calendar** or the Calendar panel. When a connection fails, its error shows above the meetings.
