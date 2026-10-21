---
description: How Ajour handles local workspace data, credentials, network requests and privacy questions.
sidebar: false
editLink: false
lastUpdated: false
prev: false
next: false
---

# Privacy policy

Last updated: October 21, 2026

<a href="/legal/confidentialite" lang="fr">Version française</a> · [Terms of service](/legal/terms)

## Who is responsible

Ajour is published by Alex Trépanier, doing business as cabochons.io. In this policy, "we" and "us" mean Alex Trépanier. Alex Trépanier is also the person responsible for the protection of personal information. Contact him at [info@cabochons.io](mailto:info@cabochons.io) for privacy questions, requests or complaints.

This policy covers the Ajour application, its documentation website and information you send us. Ajour is a local-first time tracker. You do not need an Ajour account. We do not operate a service that receives your workspace for storage or backup, and the app does not send us usage telemetry or automatic crash reports.

## Google account and calendar data

Google sign-in and the Google Calendar plugin are under development and are not included in the current public release. This section describes their intended data handling. It does not describe the security of current token-based plugins. We will update this policy if the implementation changes these practices before making the integration available.

### Data access and use

Connecting Google will be optional. Ajour will request `openid` and `email` to identify the Google account you choose. Calendar access will be requested separately when you enable calendar suggestions, using `https://www.googleapis.com/auth/calendar.events.owned.readonly`. That permission lets Ajour read events on Google calendars you own. It does not allow Ajour to create, edit or delete Google events. Ajour will not request Gmail, Google Drive or Google Contacts permissions for this integration.

| Google data                                                                                                                                                                                                    | Why Ajour accesses it                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your Google account's stable identifier and email address, including its verification status                                                                                                                   | To distinguish your connected accounts and show which one a connection uses. Ajour will not use your email address for marketing.                                          |
| OAuth access tokens, refresh tokens, granted permissions and token expiry information                                                                                                                          | To authenticate requests you authorise and keep the connection working without asking you to sign in for each request. These are credentials, not your Google password.    |
| Event and recurring-series identifiers, titles, start and end times, time-zone information, all-day status, cancellation status, busy/free status, your invitation response and whether you organise the event | To display calendar suggestions for the dates you view, apply your filters, recognise repeated meetings and avoid suggesting an occurrence you already added or dismissed. |

The calendar permission can expose more event details than Ajour needs. The integration will limit its requests to the fields needed for the uses above. Event descriptions, locations, conference links and other attendees' contact details are not part of Ajour's calendar suggestion records.

Reading an event will not create a time entry or change Google Calendar. When you choose to add a suggestion, its title and duration can become part of a local time entry. Remembering or hiding a recurring meeting saves its identifier, title and your chosen project/task mapping or hiding choice locally.

### Sharing and human access

Requests to Google's sign-in and Calendar services will go from your device to Google. Google receives the credentials and request information needed to answer them. We will not receive your Google account credentials or a copy of your calendar through an Ajour-operated server. The approved calendar plugin will receive the event fields needed for suggestions through Ajour's credential broker, without receiving the account's tokens.

Fetched calendar event lists are not exposed by Ajour's MCP tools. Once you turn an event into a time entry or a remembered meeting, its saved data becomes workspace data. If you authorise an agent to read that workspace, export the data or submit it to a timesheet service, the saved Google-derived content can reach your chosen AI provider or destination. Those transfers must serve the feature you requested and remain subject to Google's Limited Use requirements. General agent access is not an exception to those requirements.

We will not sell Google user data, disclose it to advertisers or data brokers, or use it to determine creditworthiness. We will not use Google Workspace API data to develop, improve or train non-personalised AI or machine-learning models, or transfer it for those purposes. These restrictions also cover data derived from Google data, such as a saved event title in a time entry.

We do not have routine human access to your Google calendar because it stays on your device. If you choose to include specific Google data in a support request, we will use it to handle that request under the contact and retention terms below. Any other access or disclosure must have the consent or other basis permitted by Google's policy and applicable law.

### Data protection

The planned Google integration will use HTTPS for requests to Google and an authorisation-code sign-in with PKCE. Access tokens will stay in memory. Refresh tokens will be stored locally with operating-system encryption. Ajour will refuse to store them if that encryption is unavailable. The broker will make authenticated requests and keep tokens out of plugin code. These are planned protections, not safeguards in the current public plugin runtime.

Local time entries and remembered meeting data use Ajour's ordinary workspace storage. Ajour does not encrypt the whole workspace. Protect your device account, use your operating system's disk encryption where available, and protect any backups or exports you make. Operating-system credential encryption does not protect against an attacker who already controls your device or user account.

### Retention

We will not keep a server-side copy of Google account or calendar data. On your device, the following retention rules will apply:

| Data                                                               | How long it stays                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access tokens                                                      | In memory during the app session, replaced as needed and cleared by signing out or closing the app.                                                                                                                                                                                                  |
| Refresh tokens                                                     | In encrypted local storage until you sign out, remove the account or replace its credentials. Signing out removes tokens on that device; it does not erase Google's authorisation on other devices.                                                                                                  |
| The connected account's identifier, email address and saved grants | Until you remove the account. Signing out can keep the account record so you can sign in again.                                                                                                                                                                                                      |
| Fetched calendar events                                            | In memory for calendar suggestions, with no saved calendar archive. Reloading or closing Ajour clears this cache. A failed refresh can keep the previous in-memory results.                                                                                                                          |
| Records that you added or dismissed an occurrence                  | Locally until the connection is removed, or until a later workspace load prunes records for events more than 90 days old.                                                                                                                                                                            |
| Remembered or hidden recurring meetings                            | Locally until you remove the remembered meeting or its calendar connection. These records include the meeting's identifier and title.                                                                                                                                                                |
| Time entries created from events                                   | As part of your workspace until you delete them. If an entry was already committed to an external timesheet, Ajour keeps its last committed values as a pending deletion until you commit that deletion. Removing the Google account or connection does not delete time entries you chose to create. |

Your own backups and exports can keep copies after you delete data from Ajour. Their retention is under your control. Google and any destination to which you intentionally send data control their own copies under their policies.

### Disconnecting and deleting Google data

When this integration becomes available, signing out in Ajour will delete the account's local tokens and stop authenticated access through that account. Removing the account will also remove its saved identity and grants. Removing a calendar connection will remove its remembered meetings and occurrence decisions. To remove time entries you created from events, delete those entries separately and commit any pending deletion of an entry already sent to your timesheet. To clear fetched events from memory, reload or close Ajour.

You can revoke Ajour's permission in your [Google Account's third-party connections](https://myaccount.google.com/connections). Provider-side revocation is separate from local deletion. For Google, it removes the project's authorisation across devices; other devices can still retain local data already fetched or saved. Disconnecting Ajour does not delete your original Google Calendar events.

For complete local removal, follow [Your data](/app/data#back-up-export-or-delete-data), including deleting your own backups and exports. To ask about or request deletion of Google data you intentionally sent us in a support request, write to [info@cabochons.io](mailto:info@cabochons.io). We cannot remotely delete a workspace we do not hold.

### Google's Limited Use requirements

Ajour's use and transfer of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements. This applies to the Google data and derived data described above. A future feature that needs additional data or a new disclosure will require updated information and any consent required before that access or disclosure occurs.

## Your local workspace

Ajour stores projects, tasks, time entries, notes, backlog items, imported content, settings and plugin connections on your device. Data read from a connected service can include work-item descriptions, comments and people's names or contact details. Calendar events are fetched for display rather than saved as a calendar archive. An event you turn into a time entry becomes part of your workspace.

These records support the features you use. They are not sent to us through the normal local workflow. We do not sell personal information, use it for advertising or build profiles of your activity for our own purposes.

The [Your data guide](/app/data) lists the storage locations, backup steps and deletion options. Your own operating system, backup tools or device administrator may also have access to local files.

## Credentials and plugin access

In the current release, connection tokens and other secret connection fields are stored unencrypted in the local `app-api-state.json` file. Ajour restricts the file's permissions, masks secret fields in settings and redacts known connection secrets from plugin errors and summaries. These measures reduce accidental disclosure. They do not isolate credentials from installed plugin code or other programs running as you.

Ajour currently passes a plugin the credentials for its connection. Plugin code runs with your user's permissions, can access local files and can make network requests. It is not sandboxed. Install plugins you trust, use tokens with the fewest permissions you need and protect your data folder and backups.

We are responsible for how Ajour handles credentials. The planned credential broker will keep credentials out of plugin code, store them locally with operating-system encryption and make approved authenticated requests on a plugin's behalf. Separate plugin sandboxes are also planned. These protections have not shipped and are not guarantees about the current release. Even with a broker, a plugin could misuse data or actions within the access you approve.

## Network requests and connected services

Ajour uses the network for the following purposes:

| Feature                      | Information and destination                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App updates                  | The desktop app contacts GitHub on startup, about every four hours while open, and when you ask. Requests concern release information, including the update track and installed version where needed. An update downloads only after your confirmation. |
| Plugin catalog and downloads | Ajour contacts GitHub for the catalog, its images and release information. The catalog refreshes at launch and every 15 minutes by default. Downloading a plugin contacts GitHub and its download hosts.                                                |
| Connected tools              | A plugin sends requests, credentials and the data needed for its operations to the service you configure, such as Azure DevOps, Jira, GitHub or a calendar host. Reading and writing can happen on a sync timer or when you use a feature.              |
| Shared projects              | A team plugin sends shared project and task fields to your team's chosen backend. Ajour's team-sync contract does not send time entries or their notes. The backend operator controls its copy and retention.                                           |
| Agents                       | An agent client or task can read workspace data and browser content and send it to the AI provider you configured. An agent task can also enter data into a service such as Workday.                                                                    |

Every contacted service receives ordinary connection information, including your IP address and request metadata. Update and catalog requests do not carry your time entries or connection tokens. Providers handle requests under their own policies. GitHub describes its practices in its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Connecting a service, allowing an agent to read data or exporting a file can disclose information outside your device. Check your organisation's rules before sharing work or other people's information. Data you send to a source tool, team backend or AI provider may remain there after you remove the connection in Ajour. Their terms, retention rules and deletion tools apply to those copies. This policy does not offer an Ajour-hosted team service.

## Agent browser sessions

MCP and the agent runner are optional. An agent can send the information it reads to its provider, including time entries, notes, work-item content and pages it visits. We do not receive that information merely because you use Ajour's agent features.

In its separate browser mode, the agent runner keeps a local browser profile between runs. That profile can retain cookies and signed-in sessions, including Workday sessions. When you attach an agent to your own browser, that browser keeps its own session data. Ending a task does not sign you out. See [Your data](/app/data#back-up-export-or-delete-data) for how to clear local sessions.

## Planned Microsoft sign-in

Microsoft sign-in through the credential broker is also under development and is not available in the current release.

If you sign in with a Microsoft account through that feature, Ajour will keep its account credentials encrypted on your device and will not send them to us or hand them to plugin code. It will request the minimum permissions for the features you choose, with identity information only as needed to distinguish accounts. Calendar access will be requested when you enable it. Approved plugins will use the account through the broker.

The release that introduces Microsoft sign-in will update this policy and explain its permissions, account removal and provider-side revocation. Removing a local credential and revoking a provider's permission are different actions.

## This website

The documentation website is hosted on GitHub Pages and delivered through Cloudflare. These providers process technical request information, such as IP addresses, requested pages, request times and browser headers, to deliver and protect the site. Their infrastructure may process data outside Quebec or Canada.

We do not add advertising trackers or usage analytics to the site. The site can remember local interface preferences, such as your colour theme. Hosting and security providers may use their own necessary cookies or similar mechanisms. Their policies describe their handling and retention of technical data: [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) and [Cloudflare](https://www.cloudflare.com/privacypolicy/).

Following an external link takes you to a service with its own privacy practices.

## When you contact us

If you email us or open a GitHub issue, we receive what you choose to send, such as your name, email address, message and attachments. We use it to answer you, investigate the reported problem or handle your privacy request. Do not send credentials or confidential workspace files. GitHub issues are public, so remove personal and confidential information before posting.

Email and GitHub providers process those communications and may store them outside Quebec or Canada. We keep correspondence only as long as needed for the request, related follow-up and legal obligations, then delete it when it is no longer needed. Public GitHub discussions follow GitHub's retention and removal rules. We may disclose information we hold when legally required or where the law permits it to address a security incident.

## Your choices and rights

You can use the local tracker without a plugin or agent. You can turn plugins off, remove connections, stop an agent task, revoke an MCP client and delete local data. Protect or delete your own exports and backups separately. Deleting local files does not revoke a credential at its provider or remove a copy already sent to another service.

For personal information we hold, contact [info@cabochons.io](mailto:info@cabochons.io) to request access, correction, deletion or a portable copy where applicable law provides those rights. You may also withdraw consent where processing relies on it, subject to legal limits. We may ask for information needed to verify your identity. We cannot retrieve or delete a workspace that exists only on your device, or act for an independent service provider.

Send privacy complaints to the same address. In Quebec, you can also contact the [Commission d'accès à l'information](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/citoyens-protection-renseignements-personnels/acces-et-protection-renseignements-personnels).

## Changes to this policy

We will publish changes here and update the date above. Material changes will include a notice on this page explaining what changed. A policy update does not by itself authorise a new use of your information where consent is required. The page's earlier versions remain available in the repository's history.

October 21, 2026: Expanded the Google account and calendar disclosures to name the intended data, purposes, recipients, security measures, retention periods and deletion options. Google sign-in remains under development.
