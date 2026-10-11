// Prettier defaults, as in create-t3-app and Matt Pocock's projects.
// The Tailwind plugin sorts class names in the web app.
/** @type {import("prettier").Config & import("prettier-plugin-tailwindcss").PluginOptions} */
export default {
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./apps/web/src/styles.css",
  tailwindFunctions: ["cn", "cva"],
};
