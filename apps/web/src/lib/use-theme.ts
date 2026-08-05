import { useEffect, useSyncExternalStore } from "react";
import { useUserPreferences } from "@/lib/local-hooks";
import type { ThemeMode } from "@/domain/local-state";

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeToSystemTheme(callback: () => void): () => void {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

export function useSystemTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, () => "dark");
}

export function useResolvedTheme(): "dark" | "light" {
  const preferences = useUserPreferences();
  const systemTheme = useSystemTheme();

  if (preferences.themeMode === "system") {
    return systemTheme;
  }

  return preferences.themeMode;
}

export function useApplyTheme(): void {
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    const root = document.documentElement;

    if (resolvedTheme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }

    window.timetrackerDesktop?.setWindowChromeTheme?.(resolvedTheme);
  }, [resolvedTheme]);
}

export function getThemeModeLabel(mode: ThemeMode): string {
  switch (mode) {
    case "system":
      return "System";
    case "dark":
      return "Dark";
    case "light":
      return "Light";
  }
}
