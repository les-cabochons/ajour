---
description: How Ajour handles local workspace data, credentials, network requests and privacy questions.
sidebar: false
editLink: false
lastUpdated: false
prev: false
next: false
---

# Privacy policy

Last updated: October 20, 2026

<a href="/legal/confidentialite" lang="fr">Version française</a> · [Terms of service](/legal/terms)

## Who is responsible

Ajour is published by Alex Trépanier, doing business as cabochons.io. In this policy, "we" and "us" mean Alex Trépanier. Alex Trépanier is also the person responsible for the protection of personal information. Contact him at [info@cabochons.io](mailto:info@cabochons.io) for privacy questions, requests or complaints.

This policy covers the Ajour application, its documentation website and information you send us. Ajour is a local-first time tracker. You do not need an Ajour account. We do not operate a service that receives your workspace for storage or backup, and the app does not send us usage telemetry or automatic crash reports.

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

## Planned Google and Microsoft sign-in

Built-in handling of Google and Microsoft sign-in through the credential broker is not available in the current release. This section describes the intended handling when that feature becomes available, rather than the security of today's token-based plugins.

If you sign in with a Google or Microsoft account through that feature, Ajour will keep its account credentials encrypted on your device and will not send them to us or hand them to plugin code. It will request the minimum permissions for the features you choose, with identity information only as needed to distinguish accounts. Calendar access will be requested when you enable it. Approved plugins will use the account through the broker.

Ajour's use and transfer of information received from Google APIs will follow the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements. Google user data will be used only for the visible features you enable. It will not be sold, used for advertising or used to train general-purpose AI models. Any permitted transfer will remain subject to that policy and the consent it requires.

The release that introduces sign-in will update this policy and explain its permissions, account removal and provider-side revocation. Removing a local credential and revoking a provider's permission are different actions.

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
