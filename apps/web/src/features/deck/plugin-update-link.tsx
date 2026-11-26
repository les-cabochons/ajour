import { useCallback } from "react";
import {
  SettingsLink,
  useOpenSettings,
} from "@/features/settings/settings-link";

/**
 * The way to update a code host plugin older than what Deck asks of it:
 * a link to Settings › Plugins, after the read's own message that says
 * which plugin and what for.
 */
export function PluginUpdateLink() {
  return (
    <SettingsLink
      page="plugins"
      className="text-primary underline-offset-2 hover:underline"
    >
      Open Settings › Plugins
    </SettingsLink>
  );
}

/** Opens Settings › Plugins, for a menu item that can't hold a link. */
export function useOpenPluginSettings() {
  const openSettings = useOpenSettings();
  return useCallback(() => void openSettings("plugins"), [openSettings]);
}
