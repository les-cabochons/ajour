// First-launch fallback sourced from les-cabochons/ajour-plugins-index.
// The remote catalog remains authoritative whenever it is reachable.
const BUILT_IN_PLUGIN_CATALOG_ENTRIES = [
  {
    schemaVersion: 1,
    id: "azure_devops",
    type: "connector",
    title: "Azure DevOps",
    description:
      "Sync Azure DevOps work items into Ajour's local backlog and update estimates from Ajour.",
    author: {
      name: "Alex Trépanier",
      url: "https://github.com/alextrepa",
    },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajc-azure-devops/blob/main/LICENSE",
    },
    website: "https://github.com/les-cabochons/ajc-azure-devops#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajc-azure-devops",
      url: "https://github.com/les-cabochons/ajc-azure-devops",
    },
    status: "available",
    compatibility: { pluginApiVersion: 1 },
    capabilities: ["work-item-sync", "estimate-update"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^azure_devops-[0-9A-Za-z.+-]+\\.harday-connector$",
    },
    tags: ["azure-devops", "project-management", "synchronization"],
  },
  {
    schemaVersion: 1,
    id: "jira",
    type: "connector",
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
      url: "https://github.com/les-cabochons/ajc-jira/blob/main/LICENSE",
    },
    website: "https://github.com/les-cabochons/ajc-jira#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajc-jira",
      url: "https://github.com/les-cabochons/ajc-jira",
    },
    status: "available",
    compatibility: { pluginApiVersion: 1 },
    capabilities: ["work-item-sync", "estimate-update"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^jira-[0-9A-Za-z.+-]+\\.harday-connector$",
    },
    tags: ["jira", "project-management", "synchronization"],
  },
  {
    schemaVersion: 1,
    id: "workday-project-data",
    type: "plugin",
    title: "Workday project data shape",
    description:
      "Shapes project and task records for Workday-compatible file transfers without connecting to Workday.",
    author: {
      name: "Alex Trépanier",
      url: "https://github.com/alextrepa",
    },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajour/blob/main/LICENSE",
    },
    website: "https://github.com/les-cabochons/ajp-workday",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajp-workday",
      url: "https://github.com/les-cabochons/ajp-workday",
    },
    status: "coming-soon",
    compatibility: { pluginApiVersion: 1 },
    capabilities: ["project-data-shape"],
    tags: ["workday", "import", "export", "data-shape"],
  },
];

module.exports = { BUILT_IN_PLUGIN_CATALOG_ENTRIES };
