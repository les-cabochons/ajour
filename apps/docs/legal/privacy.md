---
description: How Ajour handles local workspace data, credentials, network requests and privacy questions.
sidebar: false
editLink: false
lastUpdated: false
prev: false
next: false
---

# Privacy policy

Last updated: November 26, 2026

<a href="/legal/confidentialite" lang="fr">Version française</a> · [Terms of service](/legal/terms)

## Who is responsible

Ajour is published by Alex Trépanier, doing business as cabochons.io. In this policy, "we" and "us" mean Alex Trépanier. Alex Trépanier is also the person responsible for the protection of personal information. Contact him at [info@cabochons.io](mailto:info@cabochons.io) for privacy questions, requests or complaints.

This policy covers the Ajour application, the plugins we maintain, its documentation website and information you send us. Ajour is a local-first time tracker. You do not need an Ajour account. We do not operate a service that receives your workspace for storage or backup, and the app does not send us usage telemetry or automatic crash reports.

## The Ajour app

This section covers the app's storage, credentials, network requests and agent access. The plugin sections below describe the data used by each plugin we maintain. Optional plugins and agents can send data to the services you choose.

### Your local workspace

Ajour stores projects, tasks, time entries, notes, backlog items, imported content, settings and plugin connections on your device. Data read from a connected service can include work-item descriptions, comments and people's names or contact details. Calendar events are fetched for display rather than saved as a calendar archive. An event you turn into a time entry becomes part of your workspace. Deck keeps the pull requests it reads, with the full content of their changed files, their diffs and guides, in a content cache on your device, under a size limit you set in Settings › Storage; after each sync it reads the ones waiting on you, before you open them. Each code host section below says what it reads.

Deck's draft reviews are stored in your local workspace too: the comments you add to a pull request's review before you submit it, each with its file, its lines and their text, so a later push can mark it outdated, and, while a review you submitted or a comment you posted from a closed pull request's draft isn't confirmed by the code host, a random name for it and when it was first sent, so a retry doesn't post it twice. A draft survives restarts and stays until you submit it, post it, remove its comments or discard it, also after the pull request closes, which keeps that pull request in your local list meanwhile. Removing the connection deletes its drafts. Nothing in a draft leaves your device before you submit it.

These records support the features you use. They are not sent to us through the normal local workflow. We do not sell personal information, use it for advertising or build profiles of your activity for our own purposes.

The [Your data guide](/app/data) lists the storage locations, backup steps and deletion options. Your own operating system, backup tools or device administrator may also have access to local files.

Importing or exporting projects and time entries reads or writes files on your device. A schema plugin that only maps local records to file columns, such as the Workday schema, adds no separate external data flow. You choose where to save or send the exported file.

### Credentials and plugin access

Connection tokens and other secret fields, of connections and agent task settings, are stored in the local `app-api-vault.json` file, encrypted with a key your operating system keeps for your user. The `app-api-state.json` file records only which secret fields are set. Ajour refuses to save a secret when the computer can't encrypt it, and never falls back to plain text. It also masks secret fields in settings and redacts known connection secrets from plugin errors and summaries. These measures reduce accidental disclosure, such as through a copied data folder. They do not isolate credentials from installed plugin code or other programs running as you.

Ajour currently decrypts a connection's credentials to pass them to that connection's plugin. Plugin code runs with your user's permissions, can access local files and can make network requests. It is not sandboxed. Install plugins you trust, use tokens with the fewest permissions you need and protect your data folder and backups.

We are responsible for how Ajour handles credentials. The planned credential broker will keep credentials out of plugin code and make approved authenticated requests on a plugin's behalf. Separate plugin sandboxes are also planned. These protections have not shipped and are not guarantees about the current release. Even with a broker, a plugin could misuse data or actions within the access you approve.

### Network requests and connected services

The desktop app makes these requests for updates and plugin discovery, independently of any service you connect:

| Feature                      | Information and destination                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App updates                  | The desktop app contacts GitHub on startup, about every four hours while open, and when you ask. Requests concern release information, including the update track and installed version where needed. An update downloads only after your confirmation. |
| Plugin sources and downloads | Ajour contacts the host of each plugin source in your list, GitHub for the official one, to read its listing, signature and images. It reads them at launch and every 15 minutes by default. Downloading a plugin reads its files from the same host.   |

GitHub, its download hosts and the hosts of the plugin sources you add receive ordinary connection information, including your IP address and request metadata. Update and plugin source requests do not carry your time entries or connection tokens. GitHub describes its practices in its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

A plugin's own service requests are described below. Opening an external link or sending an exported file can also disclose information to the destination you choose.

### Agent browser sessions

MCP and the agent runner are optional. An agent can send the information it reads to its provider, including time entries, notes, work-item content and pages it visits. We do not receive that information merely because you use Ajour's agent features.

When you ask for more detail about a pull request in Deck, Ajour sends what the question needs to the agent you picked in Settings › Agents, which sends it to its provider: the concern's title, rationale and changed lines, any other hunks and changed files of that pull request the agent reads, at the base or the latest commit, the pull request's review threads with their comments and authors' names, and your question when you type one. Ajour asks once for each repository before the first question, naming the agent and its version, and asks again when you pick another agent. Settings › Agents lists the repositories you allowed, with Revoke. Nothing is sent before you ask. Ajour keeps each answer in memory for the pull request and commit it is about, so asking again shows it at once; closing Ajour clears them.

When you ask an agent about a pull request in Deck, the agent's CLI saves the conversation, its transcript included, in its own folder in your user profile: `~/.claude/projects/` for Claude Code, `~/.codex/sessions/` for Codex and `~/.local/share/opencode/` for OpenCode. It keeps it so a later question about the same pull request can continue the conversation. Ajour keeps only the conversation's ID, in memory. Timesheet agent tasks save no conversation on Claude Code or Codex. OpenCode keeps each timesheet task's run in its session history too. [Your data](/app/data#agent-conversations-about-pull-requests) explains how to remove these files. Removing them doesn't delete what the agent already sent to its provider.

In its separate browser mode, the agent runner keeps a local browser profile between runs. That profile can retain cookies and signed-in sessions, including Workday sessions. When you attach an agent to your own browser, that browser keeps its own session data. Ending a task does not sign you out. See [Your data](/app/data#back-up-export-or-delete-data) for how to clear local sessions.

## Plugins we maintain

These disclosures cover plugins we maintain that access or share data. Ajour's local storage and credential handling described above also apply to them. For a plugin maintained by another author, consult that author's privacy information.

A connected service receives the credentials and request data needed for the operation, along with ordinary connection information such as your IP address. We do not receive a copy through an Ajour-operated relay. Synced workspace records follow Ajour's local storage and deletion rules. Data you send to a source tool, team backend or AI provider may remain there after you remove its connection in Ajour. The operator's terms, retention and deletion rules apply to those copies.

### Google {#google-account-and-calendar-data}

Google sign-in and the Google Calendar plugin are under development and are not included in the current public release. This section describes their intended data handling. It does not describe the security of current token-based plugins. We will update this policy if the implementation changes these practices before making the integration available.

#### Data access and use

Connecting Google will be optional. Ajour will request `openid` and `email` to identify the Google account you choose. Calendar access will be requested separately when you enable calendar suggestions, using `https://www.googleapis.com/auth/calendar.events.owned.readonly`. That permission lets Ajour read events on Google calendars you own. It does not allow Ajour to create, edit or delete Google events. Ajour will not request Gmail, Google Drive or Google Contacts permissions for this integration.

| Google data                                                                                                                                                                                                    | Why Ajour accesses it                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your Google account's stable identifier and email address, including its verification status                                                                                                                   | To distinguish your connected accounts and show which one a connection uses. Ajour will not use your email address for marketing.                                          |
| OAuth access tokens, refresh tokens, granted permissions and token expiry information                                                                                                                          | To authenticate requests you authorise and keep the connection working without asking you to sign in for each request. These are credentials, not your Google password.    |
| Event and recurring-series identifiers, titles, start and end times, time-zone information, all-day status, cancellation status, busy/free status, your invitation response and whether you organise the event | To display calendar suggestions for the dates you view, apply your filters, recognise repeated meetings and avoid suggesting an occurrence you already added or dismissed. |

The calendar permission can expose more event details than Ajour needs. The integration will limit its requests to the fields needed for the uses above. Event descriptions, locations, conference links and other attendees' contact details are not part of Ajour's calendar suggestion records.

Reading an event will not create a time entry or change Google Calendar. When you choose to add a suggestion, its title and duration can become part of a local time entry. Remembering or hiding a recurring meeting saves its identifier, title and your chosen project/task mapping or hiding choice locally.

#### Sharing and human access

Requests to Google's sign-in and Calendar services will go from your device to Google. Google receives the credentials and request information needed to answer them. We will not receive your Google account credentials or a copy of your calendar through an Ajour-operated server. The approved calendar plugin will receive the event fields needed for suggestions through Ajour's credential broker, without receiving the account's tokens.

Fetched calendar event lists are not exposed by Ajour's MCP tools. Once you turn an event into a time entry or a remembered meeting, its saved data becomes workspace data. If you authorise an agent to read that workspace, export the data or submit it to a timesheet service, the saved Google-derived content can reach your chosen AI provider or destination. Those transfers must serve the feature you requested and remain subject to Google's Limited Use requirements. General agent access is not an exception to those requirements.

We will not sell Google user data, disclose it to advertisers or data brokers, or use it to determine creditworthiness. We will not use Google Workspace API data to develop, improve or train non-personalised AI or machine-learning models, or transfer it for those purposes. These restrictions also cover data derived from Google data, such as a saved event title in a time entry.

We do not have routine human access to your Google calendar because it stays on your device. If you choose to include specific Google data in a support request, we will use it to handle that request under the contact and retention terms below. Any other access or disclosure must have the consent or other basis permitted by Google's policy and applicable law.

#### Data protection

The planned Google integration will use HTTPS for requests to Google and an authorisation-code sign-in with PKCE. Access tokens will stay in memory. Refresh tokens will be stored locally with operating-system encryption. Ajour will refuse to store them if that encryption is unavailable. The broker will make authenticated requests and keep tokens out of plugin code. These are planned protections, not safeguards in the current public plugin runtime.

Local time entries and remembered meeting data use Ajour's ordinary workspace storage. Ajour does not encrypt the whole workspace. Protect your device account, use your operating system's disk encryption where available, and protect any backups or exports you make. Operating-system credential encryption does not protect against an attacker who already controls your device or user account.

#### Retention

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

#### Disconnecting and deleting Google data

When this integration becomes available, signing out in Ajour will delete the account's local tokens and stop authenticated access through that account. Removing the account will also remove its saved identity and grants. Removing a calendar connection will remove its remembered meetings and occurrence decisions. To remove time entries you created from events, delete those entries separately and commit any pending deletion of an entry already sent to your timesheet. To clear fetched events from memory, reload or close Ajour.

You can revoke Ajour's permission in your [Google Account's third-party connections](https://myaccount.google.com/connections). Provider-side revocation is separate from local deletion. For Google, it removes the project's authorisation across devices; other devices can still retain local data already fetched or saved. Disconnecting Ajour does not delete your original Google Calendar events.

For complete local removal, follow [Your data](/app/data#back-up-export-or-delete-data), including deleting your own backups and exports. To ask about or request deletion of Google data you intentionally sent us in a support request, write to [info@cabochons.io](mailto:info@cabochons.io). We cannot remotely delete a workspace we do not hold.

#### Google's Limited Use requirements

Ajour's use and transfer of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements. This applies to the Google data and derived data described above. A future feature that needs additional data or a new disclosure will require updated information and any consent required before that access or disclosure occurs.

### Microsoft {#planned-microsoft-sign-in}

Microsoft sign-in through the credential broker is also under development and is not available in the current release.

If you sign in with a Microsoft account through that feature, Ajour will keep its account credentials encrypted on your device and will not send them to us or hand them to plugin code. It will request the minimum permissions for the features you choose, with identity information only as needed to distinguish accounts. Calendar access will be requested when you enable it. Approved plugins will use the account through the broker.

The release that introduces Microsoft sign-in will update this policy and explain its permissions, account removal and provider-side revocation. Removing a local credential and revoking a provider's permission are different actions.

### Azure DevOps

The [Azure DevOps plugin](/plugins/azure-devops) uses your organisation address and personal access token to read work items and pull requests from that organisation. This can include project and repository names, work-item titles and descriptions, estimates, states, priorities, comments, review activity and the identities of people involved. Identity information can include names, email addresses and avatars returned by Azure DevOps. People suggestions can search the organisation when your token allows it. When you open a pull request in Deck, it reads the list of the files changed in the pull request's latest iteration and the full content of each changed file at two commits: the one that iteration is compared with, where its branch and the target branch met, and its latest commit.

The plugin sends description, estimate, state, priority, comment, reaction and mention changes you request back to Azure DevOps. Imported backlog records are stored in your local workspace. Work-item comment text is fetched for display and held in memory rather than saved as a comment archive. Pull-request comment and review content can be read to derive activity and mention facts; their text is not stored as part of those synced facts. When you open a pull request in Deck, the plugin reads its description, its comment threads, its iterations with their commits, and its policy checks, and Ajour holds them in memory to show them while the page is open. With its files, it also reads the work items the pull request is linked to: their titles, descriptions, states and links. To show what changed since your review, Ajour also reads the changed files at the commits of the iteration you reviewed and of the iterations after it. Ajour builds the pull request's diff, the guide that groups its changes, and its summary, on your device from the file contents and linked work items it read, and keeps them in its content cache on your device, as described for GitHub below. The summary keeps each work item's title, state and link, never its description. When the connection's Review pull requests access is on, a comment you post from Deck, and a review you submit there, go to Azure DevOps at once: each comment as a thread on its file and lines, the review's summary as a thread, and your vote. Each thread carries that random name in a thread property Azure DevOps doesn't show; before submitting, and before a retried comment, the plugin reads the pull request's threads and skips those that carry it, so a retry repeats none. On a pull request you created, a new title, a change between draft and published, and a merge you confirm in Deck go to Azure DevOps at once, the merge with the merge type and commit message you chose; to offer only the merge types the repository allows, the plugin reads the target branch's merge-type policies. Removing a connection does not delete content already written to Azure DevOps.

### GitHub

The [GitHub plugin](/plugins/github) uses your GitHub or GitHub Enterprise Server address and personal access token. It reads your account identity, organisation and team membership needed for review requests, repository names, assigned issues and their descriptions, and pull-request facts such as authors, reviewers, checks and activity. It can read comment and review text to detect mentions and review activity. When you open a pull request in Deck, it reads the list of the pull request's changed files and the full content of each changed file at two commits: the one the pull request's branch started from and its latest commit. After each sync, it also reads them for the pull requests waiting on you, up to 20 per connection, so they open at once: Ajour reads, and keeps, pull requests you haven't opened. When you open one, it also reads its description, comments, review threads, timeline, the files you marked viewed, its checks, and its pushes with their commits, which Ajour holds in memory to show them while the page is open. To show what changed since your review, Ajour also reads the changed files at the commits of the push you reviewed and of the pushes after it. With the files, it also reads the issues the pull request closes or is linked to: their titles, descriptions, states and links.

Ajour keeps imported issues and pull-request facts locally, with the commit of the version you last reviewed. Pull-request comment and review text is not stored in those facts. Ajour builds the pull request's diff, the guide that groups its changes, and the summary that lists what to look at, on your device from the file contents and linked issues it read. The summary keeps each linked issue's title, state and link, never its description. It keeps the file contents, the diff, the guide with its summary, and which hunks changed since the version you reviewed in a content cache on your device, in Ajour's data folder, so the pull request opens at once, also after a restart. Each new commit is kept beside the earlier ones. The cache is never sent anywhere. It stays under its size limit, 1 GB unless you set another in Settings › Storage, by deleting merged and closed pull requests first, then those used longest ago. Clear cache in Settings › Storage deletes all of it, and removing the connection deletes its pull requests from it. Your draft reviews are not part of it. When you ask to change an issue's state, the plugin sends that change to GitHub. When the connection's Review pull requests access is on, a comment you post from Deck goes to GitHub at once, on its file and lines or on the conversation, and so does a review you submit there, with its verdict, its summary and its line comments. The review's or comment's text starts with a hidden line holding its random name, which GitHub's pages don't show; on a retry, the plugin reads the pull request's reviews or comments back to the first try and sends nothing when one of yours already carries it, so a retry doesn't post it twice. On a pull request you opened, a new title, a change between draft and ready for review, and a merge you confirm in Deck go to GitHub at once, the merge with the method and commit title you chose; before merging, and again when a merge fails, the plugin reads the pull request, so a merge happens once. Removing the connection does not remove the original issues or pull requests from GitHub.

### Jira

The [Jira plugin](/plugins/jira) uses your Jira site address, account email address and API token to authenticate to that site. It reads the account identifier used to validate the connection and issue data such as project and issue identifiers, titles, descriptions, assignees, estimates, states and priorities.

Imported issues are kept in your local workspace. Estimate, status and priority changes you request are sent to the Jira site. Issue comments stay in Jira in the current plugin. Removing the connection stops its requests but does not delete issues or changes already stored in Jira.

### Calendar address (ICS)

The [Calendar address (ICS) plugin](/plugins/ics) reads a private calendar feed address you provide, with an optional email address to recognise your own invitation responses. That feed address is a credential. The plugin downloads the feed directly from its host, such as Google Calendar, Outlook or Exchange. A feed can contain descriptions, locations, meeting links and other people's contact details as well as titles and times, even though Ajour does not use all those fields.

Only the calendar suggestion fields reach Ajour: event and recurring-series identifiers, title, start and end, all-day status, event status, your response, busy/free status and whether you organise the event. Fetched events stay in memory. Time entries, remembered meetings and occurrence decisions you create from them are saved locally. The plugin does not write to the calendar. Removing its connection does not revoke the private feed address; reset or unpublish that address at its provider when you want it to stop working.

### Workday agent

The [Workday agent plugin](/plugins/workday-agent) uses your Workday timesheet URL, an optional sign-in username, project and task names and codes, and the dates, durations, notes and identifiers in the week's time-entry changes. It gives the agent access to the Workday pages needed to enter and check those changes. The agent sends the data it reads to the AI provider you configured and sends requested timesheet changes to Workday.

The task does not run through an Ajour-operated AI service. Your AI provider and your employer's Workday service control their own copies. The app's agent browser can keep Workday cookies and signed-in sessions between runs. Using your own browser can expose other sites signed in to that profile. The app section above and [Your data](/app/data) explain browser storage and deletion. Ending a task or removing this plugin does not revoke a Workday session or delete data already sent to Workday or an AI provider.

### Team sync

The privately maintained Team sync plugin uses a Convex backend chosen by your team. It handles the deployment address, team name and identifier, team secret and, when required to create a team, a creation key. It sends shared project fields such as names, codes, colours, icons and status, and task names, status, billable flags and budgets. The team-sync contract does not send time entries, their notes or tracked time.

The backend stores the shared records and a hash of the team secret. It nevertheless receives the secret itself when it validates a connection or sync request. Anyone with the team identifier and secret can access the team's shared records. Disconnecting or stopping sharing leaves the backend's copy in place. Records can be archived rather than deleted through team sync; ask the backend operator about deletion and retention. This policy does not offer a publicly hosted Ajour team service.

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

November 26, 2026: Added the title, draft and merge changes the GitHub and Azure DevOps plugins send when you change your own pull request from Deck, and that the Azure DevOps plugin reads the target branch's merge-type policies. This replaces the statement that merges happen on GitHub itself.

November 24, 2026: Added that the GitHub and Azure DevOps plugins read the issues and work items a pull request you open in Deck is linked to, and that Ajour shows their titles and states in its summary, built on your device and kept with the guide in Deck's content cache, without their descriptions.

November 24, 2026: Added Deck's draft reviews, kept in your local workspace until you submit, post or discard them, and the comments, reviews and votes the GitHub and Azure DevOps plugins send when you review a pull request from Deck, with the random name each review, and each comment posted from a draft, carries so a retry doesn't post it twice. This replaces the statement that comments and reviews happen on GitHub itself.

November 24, 2026: Added that the GitHub and Azure DevOps plugins read a pull request's pushes or iterations with their commits, that Ajour reads the changed files at the versions since your review to show what changed, and that it keeps that comparison in the content cache and the version you reviewed with the pull request.

November 24, 2026: Added that the GitHub and Azure DevOps plugins read a pull request's description, comments, threads, timeline and checks when you open it in Deck, and that Ajour holds them in memory only.

November 24, 2026: Added that the Azure DevOps plugin reads the changed files of a pull request you open in Deck, and that Ajour keeps the diff it builds from them in its content cache, as for GitHub.

November 24, 2026: Added what a question about a pull request in Deck sends to the agent's provider, that Ajour asks once for each repository, and that it keeps answers in memory.

November 24, 2026: Added that Ajour keeps the file contents, diffs and guides of the pull requests it reads in a content cache on your device, and that after each sync it reads the pull requests waiting on you, including ones you haven't opened. Added that Ajour also builds a guide of the pull request's changes on your device. Added where OpenCode saves Deck's conversations, and that OpenCode also keeps timesheet task runs in its session history.

November 23, 2026: Added that the GitHub plugin reads the changed files of a pull request you open in Deck, and that Ajour keeps the diff it builds from them in memory only.

November 18, 2026: Added that the agent's CLI saves Deck's conversations about a pull request in your user profile, and how to remove them.

October 21, 2026: Expanded the Google account and calendar disclosures to name the intended data, purposes, recipients, security measures, retention periods and deletion options. Google sign-in remains under development.

October 21, 2026: Separated app-wide handling from disclosures for the plugins we maintain. Added the data flows of the Azure DevOps, GitHub, Jira, ICS, Workday agent and Team sync plugins.
