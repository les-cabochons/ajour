import { defineConfig } from "vitepress";

/**
 * The docs site for Ajour, published to GitHub Pages at
 * https://les-cabochons.github.io/ajour/. `base` must match the repository
 * name, or every asset link breaks once deployed.
 */
export default defineConfig({
  title: "Ajour",
  titleTemplate: ":title · Ajour docs",
  description: "How to track your work time with Ajour.",
  lang: "en",
  base: "/ajour/",
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  head: [
    ["link", { rel: "icon", type: "image/png", href: "/ajour/favicon.png" }],
  ],
  themeConfig: {
    logo: "/logo-mark.png",
    siteTitle: "Ajour docs",
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    socialLinks: [
      { icon: "github", link: "https://github.com/les-cabochons/ajour" },
    ],
    nav: [
      { text: "Docs", link: "/start/" },
      {
        text: "Download",
        link: "https://github.com/les-cabochons/ajour/releases",
      },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Start guide", link: "/start/" },
          { text: "Install Ajour", link: "/start/install" },
        ],
      },
      {
        text: "Tracking time",
        items: [{ text: "Day view", link: "/time/day-view" }],
      },
      {
        text: "Plugins",
        items: [{ text: "Plugins overview", link: "/plugins/" }],
      },
    ],
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
