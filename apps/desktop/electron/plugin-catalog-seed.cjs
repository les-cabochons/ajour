// First-launch fallback sourced from les-cabochons/ajour-plugins-index.
// The remote catalog remains authoritative whenever it is reachable.
const BUILT_IN_PLUGIN_CATALOG_ENTRIES = [
  {
    schemaVersion: 2,
    id: "azure_devops",
    title: "Azure DevOps",
    description:
      "Sync Azure DevOps work items into Ajour's local backlog and update estimates from Ajour, and bring in your pull requests.",
    author: {
      name: "Alex Trépanier",
      url: "https://github.com/alextrepa",
    },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajour-plugins/blob/main/plugins/azure-devops/LICENSE",
    },
    website:
      "https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/azure-devops#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajour-plugins",
      url: "https://github.com/les-cabochons/ajour-plugins",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector", "codeHost"],
    features: ["work-item-sync", "estimate-update", "pull-requests"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^azure_devops-[0-9][0-9A-Za-z.+-]*\\.ajour-connector$",
    },
    tags: ["azure-devops", "project-management", "synchronization"],
  },
  {
    schemaVersion: 2,
    id: "github",
    title: "GitHub",
    description:
      "Bring your GitHub issues into Ajour's backlog, and the pull requests you wrote or were asked to review.",
    author: {
      name: "Alex Trépanier",
      url: "https://github.com/alextrepa",
    },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajour-plugins/blob/main/plugins/github/LICENSE",
    },
    website:
      "https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/github#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajour-plugins",
      url: "https://github.com/les-cabochons/ajour-plugins",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector", "codeHost"],
    features: ["work-item-sync", "pull-requests"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^github-[0-9][0-9A-Za-z.+-]*\\.ajour-connector$",
    },
    tags: ["github", "code-review", "pull-requests"],
  },
  {
    schemaVersion: 2,
    id: "jira",
    title: "Jira",
    description:
      "Sync Jira issues into Ajour's local backlog and update estimates from Ajour.",
    author: {
      name: "Alex Trépanier",
      url: "https://github.com/alextrepa",
    },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajour-plugins/blob/main/plugins/jira/LICENSE",
    },
    website:
      "https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/jira#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajour-plugins",
      url: "https://github.com/les-cabochons/ajour-plugins",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector"],
    features: ["work-item-sync", "estimate-update"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^jira-[0-9][0-9A-Za-z.+-]*\\.ajour-connector$",
    },
    tags: ["jira", "project-management", "synchronization"],
  },
  {
    schemaVersion: 2,
    id: "workday-agent",
    title: "Workday (agent)",
    description:
      "Commit your Ajour week to the Workday web timesheet through a coding agent, Claude Code, Codex or OpenCode, in a Chrome window. Unofficial. It drives Workday's page, so it breaks when the page changes. It never signs in for you.",
    author: {
      name: "Alex Trépanier",
      url: "https://github.com/alextrepa",
    },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajour-plugins/blob/main/plugins/workday-agent/LICENSE",
    },
    website: "https://docs.ajour.day/plugins/workday-agent",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajour-plugins",
      url: "https://github.com/les-cabochons/ajour-plugins",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["agentTask"],
    features: ["timesheet-commit", "timesheet-submit", "project-properties"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^workday-agent-[0-9][0-9A-Za-z.+-]*\\.ajour-connector$",
    },
    tags: ["workday", "timesheet", "agent"],
  },
  {
    schemaVersion: 2,
    id: "workday-project-data",
    title: "Workday schema",
    description:
      "Maps project and task records to a Workday-compatible file layout without connecting to Workday.",
    author: {
      name: "Alex Trépanier",
      url: "https://github.com/alextrepa",
    },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajour-plugins/blob/main/plugins/workday-project-data/LICENSE",
    },
    website:
      "https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/workday-project-data#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajour-plugins",
      url: "https://github.com/les-cabochons/ajour-plugins",
    },
    status: "coming-soon",
    compatibility: { pluginApiVersion: 1 },
    capabilities: ["schema"],
    features: ["project-data-shape"],
    tags: ["workday", "import", "export", "data-shape"],
  },
];

module.exports = { BUILT_IN_PLUGIN_CATALOG_ENTRIES };
