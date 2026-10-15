import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./style.css";
import DocLinks from "./components/DocLinks.vue";
import Shot from "./components/Shot.vue";

/** The default VitePress theme, restyled with the app's tokens. */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DocLinks", DocLinks);
    app.component("Shot", Shot);
  },
} satisfies Theme;
