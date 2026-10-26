# Calendar address (ICS)

The Calendar address (ICS) plugin shows the meetings in your Google Calendar, Outlook or Exchange calendar in the Time view, so you can add them as time entries. See [Calendar suggestions](/time/calendar-suggestions). It reads the calendar's private address, so it needs no sign-in. It never writes to your calendar.

## Set up

1. In **Settings › Plugins**, open the **Calendars** tab and press **Download** on **Calendar address (ICS)**. The plugin starts turned off.
2. Turn on its switch.
3. Get your calendar's address. See below.
4. Open the plugin, press **Add a connection**, fill in the fields below, and press **Add connection**.

Your meetings then show in the Time view, and **Settings › Calendar** appears.

When a newer version comes out, the plugin shows **Update**. Ajour keeps its connections.

## Get your calendar's address

- **Google Calendar**: open **Settings**, pick your calendar under **Settings for my calendars**, then **Integrate calendar**. Copy **Secret address in iCal format**.
- **Outlook and Microsoft 365**: open **Settings › Calendar › Shared calendars**. Under **Publish a calendar**, pick the calendar and **Can view all details**, then publish it and copy the ICS link. Your organization may have turned publishing off.
- **Exchange in your organization**: use the same **Publish a calendar** setting in Outlook on the web, if your administrator allows it.

::: warning Keep the address secret
Anyone with the address can read your whole calendar until you reset it: **Reset private URLs** in Google Calendar, **Unpublish** in Outlook. Ajour stores it as a secret, like a token.
:::

## Connection fields

| Field                | What to enter                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connection label** | A name for this connection, such as `Work calendar`.                                                                                                                                                                                                                             |
| **Calendar**         | Which calendar this is, such as `Google Calendar`.                                                                                                                                                                                                                               |
| **Calendar address** | The address from above. Ajour never shows it again.                                                                                                                                                                                                                              |
| **Your email**       | Optional. Lets Ajour find your reply to each meeting, so **Hide meetings you declined** works. Leave it empty if the calendar has no attendee lists. Left empty, the plugin uses the calendar's name when that name is an email address, as it is for your main Google calendar. |

## What reaches Ajour

For each meeting: its time, title and status, your reply, whether it blocks your time, whether you organize it, and whether it repeats. Attendees, descriptions, locations and meeting links stay in the plugin. Ajour asks for the week you look at and does not keep the events.

## Limits

- Google serves the secret address from a cache. New and changed meetings can take several hours to show.
- Outlook's published calendars often leave out attendees, so your reply is unknown.
- A calendar larger than 5 MB, or one that takes more than 20 seconds to download, fails.
- Time zones come from the calendar. Times without a zone use the calendar's zone, then yours.

## Source

[plugins/ics](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/ics) in les-cabochons/ajour-plugins on GitHub, MIT license.
