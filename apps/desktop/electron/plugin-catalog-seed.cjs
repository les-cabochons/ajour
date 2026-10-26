// First-launch fallback: the official source's plugins, as Ajour shows them
// before it could read any plugin source. A refresh replaces it.
const OFFICIAL_SOURCE = {
  url: "https://github.com/les-cabochons/ajour-plugins",
  name: "Ajour official plugins",
  official: true,
  signed: false,
};
const REPOSITORY = {
  slug: "les-cabochons/ajour-plugins",
  url: "https://github.com/les-cabochons/ajour-plugins",
};
const AUTHOR = {
  name: "Alex Trépanier",
  url: "https://github.com/alextrepa",
};
const MIT = { name: "MIT License", spdxId: "MIT" };

function folderPage(folder) {
  return `https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/${folder}#readme`;
}

const BUILT_IN_PLUGIN_CATALOG_ENTRIES = [
  {
    id: "azure_devops",
    title: "Azure DevOps",
    description:
      "Sync Azure DevOps work items into Ajour's local backlog and update estimates from Ajour, and bring in your pull requests.",
    version: "1.1.0",
    author: AUTHOR,
    license: MIT,
    website: folderPage("azure-devops"),
    repository: REPOSITORY,
    source: OFFICIAL_SOURCE,
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector", "codeHost"],
    features: ["work-item-sync", "estimate-update", "pull-requests"],
    install: { method: "source" },
    tags: ["azure-devops", "project-management", "synchronization"],
  },
  {
    id: "github",
    title: "GitHub",
    description:
      "Bring your GitHub issues into Ajour's backlog, and the pull requests you wrote or were asked to review.",
    version: "0.2.0",
    author: AUTHOR,
    license: MIT,
    website: folderPage("github"),
    repository: REPOSITORY,
    source: OFFICIAL_SOURCE,
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector", "codeHost"],
    features: ["work-item-sync", "pull-requests"],
    install: { method: "source" },
    tags: ["github", "code-review", "pull-requests"],
  },
  {
    id: "jira",
    title: "Jira",
    description:
      "Sync Jira issues into Ajour's local backlog and update estimates from Ajour.",
    version: "1.0.0",
    author: AUTHOR,
    license: MIT,
    website: folderPage("jira"),
    repository: REPOSITORY,
    source: OFFICIAL_SOURCE,
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector"],
    features: ["work-item-sync", "estimate-update"],
    install: { method: "source" },
    tags: ["jira", "project-management", "synchronization"],
  },
  {
    id: "ics",
    title: "Calendar address (ICS)",
    description:
      "Suggest the meetings in your Google Calendar, Outlook or Exchange calendar as time entries, through the calendar's private address. Read-only.",
    version: "0.1.0",
    author: AUTHOR,
    license: MIT,
    website: folderPage("ics"),
    repository: REPOSITORY,
    source: OFFICIAL_SOURCE,
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["calendar"],
    features: ["calendar-events"],
    install: { method: "source" },
    tags: ["calendar", "ics", "google-calendar", "outlook"],
  },
  {
    id: "workday-agent",
    title: "Workday (agent)",
    description:
      "Commit your Ajour week to the Workday web timesheet through a coding agent, Claude Code, Codex or OpenCode, in a Chrome window. Unofficial. It drives Workday's page, so it breaks when the page changes. It never signs in for you.",
    version: "0.5.0",
    author: AUTHOR,
    license: MIT,
    website: "https://docs.ajour.day/plugins/workday-agent",
    repository: REPOSITORY,
    source: OFFICIAL_SOURCE,
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["agentTask"],
    features: ["timesheet-commit", "timesheet-submit", "project-properties"],
    install: { method: "source" },
    tags: ["workday", "timesheet", "agent"],
  },
  {
    id: "workday-project-data",
    title: "Workday schema",
    description:
      "Maps project and task records to a Workday-compatible file layout without connecting to Workday.",
    version: "1.0.0",
    author: AUTHOR,
    license: MIT,
    website: folderPage("workday-project-data"),
    repository: REPOSITORY,
    source: OFFICIAL_SOURCE,
    status: "coming-soon",
    compatibility: { pluginApiVersion: 1 },
    capabilities: ["schema"],
    features: ["project-data-shape"],
    tags: ["workday", "import", "export", "data-shape"],
  },
];

module.exports = { BUILT_IN_PLUGIN_CATALOG_ENTRIES };
