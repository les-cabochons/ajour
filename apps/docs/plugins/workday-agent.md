# Workday (agent)

::: warning Unofficial
This plugin types your hours into Workday's web page. It does not use a Workday API, so it breaks when Workday changes that page. A plugin that uses Workday's API may replace it.
:::

The Workday (agent) plugin adds a **Commit to Workday** button to the [Commit page](/time/commit). Ajour starts a coding agent, Claude Code, Codex or OpenCode, which reads your week's changes from Ajour and applies them to your Workday timesheet in a Chrome window. You watch it work, and it asks you when it cannot go on. Once the week is committed, **Check Workday and submit**, beside **Submit week**, has the agent check the week in Workday, fix it or ask, then submit it in Ajour.

It is a different plugin from [Workday](/plugins/workday), the schema for importing and exporting projects.

## Before you start

- Claude Code, Codex or OpenCode, installed and signed in on this computer.
- Google Chrome.
- **Allow agents** turned on in **Settings › MCP**. You do not need to add a client: each run gets its own, and Ajour revokes it when the run ends.

## Set it up

1. In **Settings › Plugins**, find **Workday (agent)** under **Agent tasks**, press **Download**, and turn it on. Version 0.5.0 or later has both tasks, and 0.6.0 or later maps tasks.
2. In **Settings › Agents**, pick the agent. Leave **Browser** on **Ajour's Chrome window** unless you want the agent to use your own Chrome profile.
3. Open **Settings › Plugins › Workday (agent)**. Under **Tasks**, fill in, once for both tasks:
   - **Workday timesheet URL**: open Enter Time in Workday and copy the address.
   - **Sign-in username**, optional: your work email. See [Sign-in](#sign-in).
4. Press **Save**. **Commit to Workday** and **Check Workday and submit** both say **Ready to run from the Commit page.**

## Match your projects

The agent finds each project in Workday by its Workday code, then its Workday name. Both default to the project's code and full name in Ajour. When Workday uses other ones, open the project, open the **Workday** section of its properties and type them.

## Map a task to a Workday task

The agent finds each task in Workday by its name. To track a task of your own that Workday does not have, such as `Knowledge transfer`, map it to one Workday has, such as `07 Run`:

1. Create the task in the project, or open it in the task editor.
2. Under **Workday**, pick the Workday task in **Workday task**. It lists the project's other tasks. Pick **Same name** to undo the mapping.
3. Press **Save**. The task list shows "→ 07 Run" after the task's name.

Workday then gets your time on `07 Run`, and each comment starts with your task's name, such as `Knowledge transfer: Walked Sam through the sync worker`. On the Commit page, the change shows "as 07 Run", and with **Names** on **Workday** the lines name `07 Run`.

Entries committed before you change a mapping stay on the old Workday task until they change again. The next commit of such an entry finds it by its ID and moves it to the new task. **Check Workday and submit** also finds them and offers to move them.

## Commit a week

On the Commit page, press **Commit to Workday**. The agent panel opens with the run. The agent:

1. Reads the week's checked changes.
2. Opens Workday and goes to the week.
3. Applies each change: adds an added entry, updates an updated one, deletes a deleted one. The comment is the note on a first line and the entry's ID on a second, such as `Code review` then `ajour:1a2b3c4d`, so the agent finds its own entries again. A [mapped task](#map-a-task-to-a-workday-task)'s name starts the first line. Entries an older version wrote as `note · ajour:1a2b3c4d` still match, and the agent writes the new form the next time it updates them. It marks each change as committed in Ajour right after Workday saves it. It never changes or deletes a Workday entry without one of these IDs, unless you tell it the entry is the same.

The panel ends with a summary. Press **Stop** in the panel to end a run at any time.

**Open the week in Workday (agent)**, under the week summary, opens the timesheet in your browser.

### Run it again

Each entry keeps its ID whatever you edit, so a later run finds the entries an earlier one saved. Only the changes left on the Commit page go to Workday.

## Submit a week

When every change is committed, press **Check Workday and submit** on the Commit page. It sits beside **Submit week**, and is greyed out like it while a change is not committed or an entry runs in the week. **Submit week** still locks the week in Ajour without the agent, and checks nothing in Workday. It waits while an agent task runs. The agent:

1. Checks the week in Ajour. When the week is behind or over its targets, it asks **Submit anyway** or **Stop**.
2. Opens Workday and compares each day with what Ajour committed.
3. When Workday differs on an entry with one of the week's IDs, it lists the differences and asks: **Update Workday** makes Workday match Ajour, **I'll fix Ajour** stops so you can change and commit in Ajour first, **Leave it** goes on. It never changes an entry without an Ajour ID.
4. Submits the week in Ajour, which locks it. Workday has no Submit step. See [Submit the week](/time/commit#submit-the-week).

## Sign-in

The agent never types a password or a code, and never approves a sign-in.

With **Sign-in username** filled in, the agent clicks Workday's single sign-on button, picks your account or types your username, and waits. While Ajour's Chrome window still has your company session, sign-in finishes on its own. When the page asks for a password, a code or an approval, the agent asks you to sign in in the Chrome window, then goes on when you press **Done**.

The first run always asks you to sign in. Ajour's Chrome window keeps its own profile, so later runs reuse that session until your company makes it expire.

## What it asks you

- An updated change has no Workday entry with its ID, but an entry without an ID on that day and time type could be it: **Yes, it is the same**, **Skip** or **Stop**. When none could be it: **Skip** or **Stop**. The agent never picks an entry by its hours alone.
- A step of a move failed, for an updated change that moved day or time type: **Retry** or **Stop**. **Stop** ends the session as cancelled.
- Workday has several close matches for a task: pick one, or **Skip**.
- The week is off pace when you submit it: **Submit anyway** or **Stop**.
- Workday differs from what Ajour committed: **Update Workday**, **I'll fix Ajour** or **Leave it**.

## Privacy

The agent sends your week's changes and Workday's pages to its model provider. Ajour's Chrome window holds only what you sign in to there. With **My Chrome**, the agent can use every site your Chrome profile is signed in to.
