import { defineConfig, type DefaultTheme } from "vitepress";

/** The user guide: how to use Ajour and its official plugins. */
const guideSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Getting started",
    items: [
      { text: "Start guide", link: "/start/" },
      { text: "Install Ajour", link: "/start/install" },
      { text: "Concepts", link: "/start/concepts" },
      { text: "Keyboard shortcuts", link: "/start/shortcuts" },
    ],
  },
  {
    text: "Time",
    items: [
      { text: "Day view", link: "/time/day-view" },
      { text: "Week view", link: "/time/week-view" },
      { text: "Running entries", link: "/time/running-entries" },
      { text: "Time entries", link: "/time/entries" },
      { text: "Commit your week", link: "/time/commit" },
    ],
  },
  {
    text: "Backlog",
    items: [
      { text: "Backlog", link: "/backlog/" },
      { text: "Backlog items", link: "/backlog/items" },
      { text: "Display options", link: "/backlog/display-options" },
      { text: "Settle and snooze", link: "/backlog/settle-and-snooze" },
      { text: "Workflow states", link: "/backlog/workflow" },
    ],
  },
  {
    text: "Projects",
    items: [
      { text: "Projects", link: "/projects/" },
      { text: "Tasks", link: "/projects/tasks" },
      { text: "Import and export", link: "/projects/import-export" },
    ],
  },
  {
    text: "Pull requests",
    items: [{ text: "Pull requests", link: "/pull-requests/" }],
  },
  {
    text: "Working in Ajour",
    items: [
      { text: "Sidebar", link: "/app/sidebar" },
      { text: "Command palette", link: "/app/command-palette" },
      { text: "Narrow windows", link: "/app/narrow-windows" },
      { text: "Settings", link: "/app/settings" },
      { text: "Agents and MCP", link: "/app/agents" },
      { text: "Your data", link: "/app/data" },
    ],
  },
  {
    text: "Plugins",
    items: [
      { text: "Plugins overview", link: "/plugins/" },
      { text: "Azure DevOps", link: "/plugins/azure-devops" },
      { text: "Jira", link: "/plugins/jira" },
      { text: "GitHub", link: "/plugins/github" },
      { text: "Workday", link: "/plugins/workday" },
      { text: "Workday (agent)", link: "/plugins/workday-agent" },
      { text: "Sync review", link: "/plugins/sync-review" },
    ],
  },
];

/** The developer guide: how to write a plugin. */
const developerSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Plugin API",
    items: [
      { text: "Overview", link: "/developers/" },
      { text: "Build a connector", link: "/developers/build-a-connector" },
      { text: "Runtime and limits", link: "/developers/runtime" },
      { text: "Test and debug", link: "/developers/testing" },
      { text: "Publish a plugin", link: "/developers/publish" },
    ],
  },
  {
    text: "Reference",
    items: [
      { text: "Manifest", link: "/developers/manifest" },
      { text: "Connector API", link: "/developers/connector-api" },
      { text: "Code host API", link: "/developers/code-host-api" },
      { text: "Calendar API", link: "/developers/calendar-api" },
      { text: "Schema API", link: "/developers/schema-api" },
      { text: "Catalog entry", link: "/developers/catalog-entry" },
    ],
  },
];

/**
 * The docs site for Ajour, published to GitHub Pages at
 * https://docs.ajour.day/. The custom domain serves the site from the root, so
 * `base` stays "/". A subpath here breaks every asset link once deployed.
 */
export default defineConfig({
  title: "Ajour",
  titleTemplate: ":title · Ajour docs",
  description: "How to track your work time with Ajour.",
  lang: "en",
  base: "/",
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  head: [["link", { rel: "icon", type: "image/png", href: "/favicon.png" }]],
  themeConfig: {
    logo: "/logo-mark.png",
    siteTitle: "Ajour docs",
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    socialLinks: [
      { icon: "github", link: "https://github.com/les-cabochons/ajour" },
    ],
    nav: [
      { text: "Docs", link: "/start/", activeMatch: "^/(?!developers/)" },
      {
        text: "Developers",
        link: "/developers/",
        activeMatch: "^/developers/",
      },
      {
        text: "Download",
        link: "https://github.com/les-cabochons/ajour/releases",
      },
    ],
    sidebar: {
      "/developers/": developerSidebar,
      "/": guideSidebar,
    },
    editLink: {
      pattern:
        "https://github.com/les-cabochons/ajour/edit/main/apps/docs/:path",
      text: "Edit this page on GitHub",
    },
    docFooter: { prev: "Previous", next: "Next" },
    footer: {
      message: "Ajour keeps your time on your machine.",
    },
  },
});
