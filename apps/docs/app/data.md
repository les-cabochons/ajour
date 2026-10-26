# Your data

Ajour keeps your workspace on your machine. You do not need an Ajour account, and Ajour does not upload your workspace to a server we run or send us usage telemetry. Optional plugins and agents connect to the services you choose. This page explains storage, network requests and deletion. The [privacy policy](/legal/privacy) covers the app, this website and information you send us.

## Where Ajour stores data

The desktop app keeps everything in one folder:

| Platform | Folder                                |
| -------- | ------------------------------------- |
| macOS    | `~/Library/Application Support/Ajour` |
| Windows  | `%APPDATA%\Ajour`                     |

The folder holds:

- **Your workspace**: projects, tasks, entries, backlog items, workflow and preferences, in the app's local storage.
- **`app-api-state.json`**: plugin connections, items waiting in Sync review, MCP clients and agent task settings. It records which secret fields are set, never their values.
- **`app-api-vault.json`**: the vault, with the secrets of connections and agent task settings, such as tokens and secret calendar addresses, encrypted by your operating system.
- **`plugins/`**: installed plugins.
- **`plugin-catalog/`**: the last listing read from each plugin source, and its plugins' images.
- **`agent-browser-profile/`**: the browser profile used by agent tasks in their separate browser mode. It keeps cookies, sessions and other browser data, including a Workday sign-in, between runs. An agent attached to your own browser uses that browser's profile instead.

To back up Ajour, quit it and copy this folder.

::: warning Plugin credentials
Connection tokens, such as an Azure DevOps personal access token, are stored in `app-api-vault.json`, encrypted with a key your operating system keeps for your user: the Windows data protection API, or the macOS keychain. Ajour moves tokens saved by earlier versions there at its first launch, and removes them from `app-api-state.json`. When the computer can't encrypt them, Ajour refuses to save a token rather than keep it in plain text, and the connections that need one pause. Ajour doesn't release a Linux build. One built from source stores no secret without a secret store such as GNOME Keyring or KWallet, and the coming sandboxed plugin host won't run plugins on Linux.

Encryption keeps a copy of the folder from handing out your tokens. It doesn't stop programs running as you from asking the operating system to decrypt them. Installed plugin code still receives its connection's credentials, so give each token only the permissions its plugin needs, and an expiry date.
:::

## When Ajour uses the network

Ajour makes these network requests, some of them on a timer:

- **GitHub releases**, to check for updates on startup, every 4 hours and when you ask, in the desktop app. Updates download only when you choose to update.
- **Your plugin sources**, at launch and every 15 minutes by default: the official one on GitHub, and each repository you add, on its own host. Ajour reads their `ajour.json` and its signature, and plugin images, which it caches locally. Downloading a plugin reads its files from the same host. Adding a source on an unknown host first asks that host which kind of git server it is.
- **The tools you connect**, such as Azure DevOps, Jira, GitHub or your calendar, when you press **Sync**, on the connection's timer, and when you open a week or an item's comments.
- **Your team's backend**, through a team plugin, for the project and task fields you share. This does not include time entries or their notes. The operator of that backend controls its storage and retention.
- **Your AI provider and the sites an agent visits**, when you use [MCP or an agent task](/app/agents). The agent can send the data it reads, including time entries, notes and browser content, to the provider you configured. A task can also enter your timesheet into a service such as Workday.

Each contacted service receives ordinary request information, including your IP address. Update and plugin source requests do not include your time entries or connection tokens. Exporting data to a destination you choose or opening an external link can also send information outside your device.

## What plugins can see

Ajour passes a plugin its connection settings, including its credentials, and data needed for its operations. A team plugin also gets the projects and tasks you share. Ordinary plugin calls do not include your time entries or another plugin's connection. This is a limit on what Ajour passes, not an isolation guarantee: plugin code runs with your user's permissions, can read local files and can reach the network. Ajour does not currently sandbox it. See [Plugins](/plugins/#trust).

Ajour masks secret fields in its settings and redacts known connection secrets from plugin errors and summaries. It decrypts a connection's credentials only to run that connection's plugin. Those protections do not stop plugin code from reading the credentials it receives. The planned credential broker will keep secrets out of plugin code and make authenticated requests on its behalf. It has not shipped. The [privacy policy](/legal/privacy#credentials-and-plugin-access) explains that distinction.

## Back up, export or delete data

Quit Ajour before copying its data folder. A copy includes browser sessions, so protect it like the original. Its credentials stay encrypted with a key your operating system keeps for your user. A copy restored on another computer usually can't read them, unless the key moved too, as macOS Migration Assistant can copy the keychain. After an administrator resets your Windows password, they can't be read either. Ajour then keeps each connection's settings and data, and pauses its sync until you enter its token again. The app's [exports](/projects/import-export) cover the data offered by each export format, not a complete backup of this folder.

Removing a connection deletes its saved credentials from the vault. It does not revoke a token at the provider or delete records already sent to a source tool, a team backend or an AI provider. Turn a plugin off to stop its sync without deleting its data or credentials. Uninstalling it removes its connections and all its credentials; imported backlog items remain.

An earlier version of Ajour, opened on the same folder after this one, finds no tokens and asks for them again. Copies of `app-api-state.json` made by an earlier version, such as old backups, still hold their tokens in plain text: delete them or keep them private.

To remove all desktop data, quit Ajour and delete the folder listed above and any copies you made. Uninstalling the application may leave that folder behind. To clear only the separate agent browser's sessions, close that browser and Ajour, then delete `agent-browser-profile/`. Clear sessions in your own browser separately if an agent used it. Revoke tokens and sign-ins at the service that issued them when you no longer want them to work.
