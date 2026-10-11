export const PROJECT_ICON_NAMES = [
  "dot",
  "plane",
  "bookmark",
  "book",
  "briefcase",
  "bed",
  "bell",
  "code",
  "terminal",
  "chart",
  "analytics",
  "megaphone",
  "brush",
  "bug",
  "tools",
  "settings",
  "cup",
  "phone",
  "card",
  "message",
  "check-circle",
  "cloud",
  "database",
  "puzzle",
  "eye",
  "drop",
  "apple",
  "restaurant",
  "goblet",
  "flask",
  "folder",
  "gamepad",
  "lightbulb",
  "grid",
  "heart",
  "image",
  "key",
  "layers",
  "globe",
  "support",
  "leaf",
  "seedling",
  "flash",
  "map-pin",
  "lock",
  "rss",
  "building",
  "home",
  "gift",
  "calendar",
  "mail",
  "contacts",
  "report",
  "fingerprint",
  "cpu",
  "calculator",
  "camera",
  "rocket",
  "palette",
  "music",
  "movie",
  "shield",
  "medicine",
  "flag",
  "scales",
  "basketball",
  "baseball",
] as const;

export type ProjectIconName = (typeof PROJECT_ICON_NAMES)[number];

export type LocalProjectIcon =
  | { kind: "preset"; name: ProjectIconName }
  | {
      kind: "upload";
      src: string;
      maskSrc?: string;
      colorMode?: "tinted" | "native";
    };

export const DEFAULT_PROJECT_ICON: LocalProjectIcon = {
  kind: "preset",
  name: "dot",
};

const projectIconNameSet = new Set<string>(PROJECT_ICON_NAMES);

export function isProjectIconName(value: string): value is ProjectIconName {
  return projectIconNameSet.has(value);
}

export function normalizeProjectIcon(icon: unknown): LocalProjectIcon {
  if (icon && typeof icon === "object") {
    const kind =
      "kind" in icon && typeof icon.kind === "string" ? icon.kind : undefined;

    if (
      kind === "preset" &&
      "name" in icon &&
      typeof icon.name === "string" &&
      isProjectIconName(icon.name)
    ) {
      return { kind, name: icon.name };
    }

    if (
      kind === "upload" &&
      "src" in icon &&
      typeof icon.src === "string" &&
      icon.src.trim()
    ) {
      const colorMode =
        "colorMode" in icon && icon.colorMode === "native"
          ? "native"
          : "tinted";
      const maskSrc =
        "maskSrc" in icon &&
        typeof icon.maskSrc === "string" &&
        icon.maskSrc.trim()
          ? icon.maskSrc.trim()
          : undefined;

      return {
        kind,
        src: icon.src.trim(),
        maskSrc,
        colorMode,
      };
    }
  }

  return DEFAULT_PROJECT_ICON;
}
