import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        foreground: "var(--text)",
        card: "var(--surface)",
        border: "var(--border)",
        primary: "var(--text)",
        "primary-foreground": "var(--bg)",
        secondary: "var(--surface-high)",
        muted: "var(--surface-low)",
        accent: "var(--danger)",
        "accent-foreground": "var(--text)",
      },
      fontFamily: {
        sans: ["'DM Sans'", "ui-sans-serif", "system-ui"],
        mono: ["'JetBrains Mono'", "'SF Mono'", "monospace"],
        serif: ["'DM Sans'", "ui-sans-serif"],
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "12px",
        "2xl": "12px",
        "3xl": "12px",
        full: "6px",
      },
      boxShadow: {
        panel: "var(--shadow-md)",
        sm: "var(--shadow-sm)",
      },
    },
  },
  plugins: [],
} satisfies Config;
