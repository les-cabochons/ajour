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
      url: "https://github.com/les-cabochons/ajc-azure-devops/blob/main/LICENSE",
    },
    website: "https://github.com/les-cabochons/ajc-azure-devops#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajc-azure-devops",
      url: "https://github.com/les-cabochons/ajc-azure-devops",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector", "codeHost"],
    features: ["work-item-sync", "estimate-update", "pull-requests"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^azure_devops-[0-9A-Za-z.+-]+\\.ajour-connector$",
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
      url: "https://github.com/les-cabochons/ajc-github/blob/main/LICENSE",
    },
    website: "https://github.com/les-cabochons/ajc-github#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajc-github",
      url: "https://github.com/les-cabochons/ajc-github",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector", "codeHost"],
    features: ["work-item-sync", "pull-requests"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^github-[0-9A-Za-z.+-]+\\.ajour-connector$",
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
      url: "https://github.com/les-cabochons/ajc-jira/blob/main/LICENSE",
    },
    website: "https://github.com/les-cabochons/ajc-jira#readme",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajc-jira",
      url: "https://github.com/les-cabochons/ajc-jira",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities: ["connector"],
    features: ["work-item-sync", "estimate-update"],
    install: {
      method: "github-release",
      allowPrereleases: true,
      assetPattern: "^jira-[0-9A-Za-z.+-]+\\.ajour-connector$",
    },
    tags: ["jira", "project-management", "synchronization"],
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
    capabilities: ["schema"],
    features: ["project-data-shape"],
    tags: ["workday", "import", "export", "data-shape"],
  },
];

module.exports = { BUILT_IN_PLUGIN_CATALOG_ENTRIES };
