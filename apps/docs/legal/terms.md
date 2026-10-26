---
description: Public terms for Ajour, its website, plugins and connected services.
sidebar: false
editLink: false
lastUpdated: false
prev: false
next: false
---

# Terms of service

Last updated: October 24, 2026

The [French version](/legal/conditions) is available in full. Reading or using this English page does not constitute an express choice to waive the French version or any language right.

[Privacy policy](/legal/privacy)

## Publisher and scope

Ajour is published by Alex Trépanier, doing business as cabochons.io. "We" and "us" mean Alex Trépanier. Contact us at [info@cabochons.io](mailto:info@cabochons.io).

These terms describe our website and our distribution of Ajour. Ajour is a local-first time tracker. It does not require an Ajour account and does not include a hosted workspace or backup service. A separately operated team backend or a service you connect has its own terms.

## Open-source licence

Ajour is distributed under the [MIT licence](https://github.com/les-cabochons/ajour/blob/main/LICENSE). That licence governs your rights to use, copy, modify and distribute the software and its included documentation, including commercial use. These terms do not withdraw or narrow those rights, impose an additional software licence or replace the licence's notices.

Third-party software and plugins keep their own licences. Ajour's name and logos do not imply our endorsement of a modified version or another publisher.

## Your workspace and responsibilities

You keep your rights to the data you enter or import. Using Ajour does not grant us ownership of your workspace or permission to publish it. The [privacy policy](/legal/privacy) explains local storage and optional disclosures.

You are responsible for the data you choose to record, the services and credentials you connect and the actions you authorise. Obtain any permission your employer, client or another person requires before importing or sharing their information. Use external accounts and services only with authority to do so, and follow their terms.

Review time entries, exports, synced changes and agent actions before relying on them for payroll, billing or an official submission. Ajour and an agent can make mistakes. Keep backups of records you need. We do not keep a recovery copy of your local workspace.

Do not use our website to distribute malware, gain unauthorised access or disrupt other people's use. This does not restrict lawful security research or rights granted by the MIT licence.

## Plugins and credential protection

Each plugin's author is responsible for that plugin's code, declared behaviour and licence. A plugin source's listing, and its signature, is not a security certification. A signature shows who published a plugin and that nobody changed it since; it does not amount to a review of the plugin's code. Install plugins from authors you trust.

We remain responsible for Ajour itself, including how it handles credentials. In the current release, Ajour stores credentials locally encrypted by the operating system, masks secret settings and redacts known connection secrets from plugin errors and summaries. Credentials are nevertheless decrypted and passed to the relevant plugin. Plugin code is not sandboxed and can read files accessible to your user, and can ask the operating system to decrypt other stored credentials.

The planned credential broker will protect credentials from plugin code by keeping secrets in Ajour and making authenticated requests on a plugin's behalf. That broker and the planned plugin sandbox have not shipped. They do not provide protection in the current release. Even with those controls, a plugin could misuse access or data you allow it to use.

A plugin author's responsibility does not exclude any responsibility that applicable law places on us. The [Your data guide](/app/data) describes the current limits and precautions.

## External services and agents

Azure DevOps, Jira, GitHub, Google, Microsoft, your team's backend, your AI provider and other services you choose operate independently of Ajour. Their terms, prices, permissions and privacy policies apply to your use of them. Their availability and APIs can change, and a plugin may stop working as a result.

Enabling MCP or starting an agent task can give an agent access to workspace data or a signed-in browser. The agent may send what it reads to your configured AI provider and may make changes in external services. Give it only the access you intend, supervise its actions and follow your organisation's rules. A browser session may remain signed in after a task ends.

We do not promise the availability, security or accuracy of independent services, and we do not offer an Ajour-hosted team service under these terms.

## Updates and support

We may change Ajour, its documentation, the plugin API or the catalog, or stop maintaining them. We do not promise a support response time, uninterrupted availability or compatibility with every plugin or external service. Nightly builds may contain unfinished changes.

The desktop app checks for updates automatically. Downloads and installation require your confirmation. You can stop using the software at any time. Stopping use or uninstalling it does not necessarily delete local data, revoke credentials or delete data already sent to another service. See [Your data](/app/data#back-up-export-or-delete-data).

## Warranties and liability

To the extent permitted by law, Ajour and its documentation are provided as available, without a promise that they will be error-free, secure in every circumstance or suitable for a particular purpose. The MIT licence contains the software's warranty and liability provisions.

To the extent permitted by law, we are not liable for indirect losses arising from use of our website or distribution of Ajour, such as lost profits or business interruption. This clause does not reduce any responsibility that cannot legally be excluded or limited.

In particular, nothing in these terms excludes or limits liability for bodily or moral injury, or for material injury caused by intentional or gross fault, where Quebec law applies. Nothing removes mandatory consumer rights, privacy rights or other protections that apply to you. These protections take priority over any conflicting term or licence disclaimer.

## Governing law and disputes

The laws of Quebec and the applicable federal laws of Canada govern these terms. Disputes may be brought before the competent courts of Quebec, subject to any mandatory right you have to use another court or remedy. These terms do not require arbitration or waive a right to bring a collective action.

You can contact [info@cabochons.io](mailto:info@cabochons.io) about a dispute. Contacting us first is not a condition for exercising a legal right.

## Changes to these terms

We will publish revisions on this page, update the date and identify material changes. Changes do not apply retroactively or cancel rights already granted by the MIT licence. Where the law requires notice or agreement, posting a revision alone does not replace it. Earlier versions remain in the repository's history.
