# Workday (agent)

::: warning Unofficial
This plugin types your hours into Workday's web page. It does not use a Workday API, so it breaks when Workday changes that page. A plugin that uses Workday's API may replace it.
:::

The Workday (agent) plugin adds a **Commit to Workday** button to the [Commit page](/time/commit). Ajour starts a coding agent, Claude Code, Codex or OpenCode, which reads your week's changes from Ajour and applies them to your Workday timesheet in a Chrome window. You watch it work, and it asks you when it cannot go on.

It is a different plugin from [Workday](/plugins/workday), the schema for importing and exporting projects.

## Before you start

- Claude Code, Codex or OpenCode, installed and signed in on this computer.
- Google Chrome.
- **Allow agents** turned on in **Settings › MCP**. You do not need to add a client: each run gets its own, and Ajour revokes it when the run ends.

## Set it up

1. Install the plugin from its `.ajour-connector` file in **Settings › Plugins**. It needs version 0.4.0 or later.
2. In **Settings › Agents**, pick the agent. Leave **Browser** on **Ajour's Chrome window** unless you want the agent to use your own Chrome profile.
3. Open **Settings › Plugins › Workday (agent)**. Under **Tasks**, fill in:
   - **Workday timesheet URL**: open Enter Time in Workday and copy the address.
   - **Sign-in username**, optional: your work email. See [Sign-in](#sign-in).
4. Press **Save**. The task says **Ready to run from the Commit page.**

## Match your projects

The agent finds each project in Workday by its Workday code, then its Workday name. Both default to the project's code and full name in Ajour. When Workday uses other ones, open the project, open the **Workday** section of its properties and type them.

## Commit a week

On the Commit page, press **Commit to Workday**. The agent panel opens with the run. The agent:

1. Reads the week's checked changes.
2. Opens Workday and goes to the week.
3. Applies each change: adds an added entry, updates an updated one, deletes a deleted one. The comment is the note, then `·` and the entry's ID, such as `Code review · ajour:1a2b3c4d`, so the agent finds its own entries again. It marks each change as committed in Ajour right after Workday saves it.

The panel ends with a summary. Press **Stop** in the panel to end a run at any time.

**Open the week in Workday**, under the week summary, opens the timesheet in your browser.

### Run it again

Each entry keeps its ID whatever you edit, so a later run finds the entries an earlier one saved. Only the changes left on the Commit page go to Workday.

## Sign-in

The agent never types a password or a code, and never approves a sign-in.

With **Sign-in username** filled in, the agent clicks Workday's single sign-on button, picks your account or types your username, and waits. While Ajour's Chrome window still has your company session, sign-in finishes on its own. When the page asks for a password, a code or an approval, the agent asks you to sign in in the Chrome window, then goes on when you press **Done**.

The first run always asks you to sign in. Ajour's Chrome window keeps its own profile, so later runs reuse that session until your company makes it expire.

## What it asks you

- An entry in Workday looks like one of yours but has no entry ID: **Same entry, mark it**, **Different, add mine** or **Skip**.
- Workday has several close matches for a task: pick one, or **Skip**.

## Privacy

The agent sends your week's changes and Workday's pages to its model provider. Ajour's Chrome window holds only what you sign in to there. With **My Chrome**, the agent can use every site your Chrome profile is signed in to.
