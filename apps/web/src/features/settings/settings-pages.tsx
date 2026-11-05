import { lazy, Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import {
  parsePluginDetailSearch,
  replaceTargetOf,
} from "@/features/settings/plugin-detail-search";
import { SettingsSearchProvider } from "@/features/settings/settings-link";
import type { SettingsLocation } from "@/features/settings/settings-location";
import { trackPageChunk } from "@/lib/route-events";

/**
 * The settings pages' code, loaded when a page first opens, and the one
 * mapping from a settings location to its page. The router's `/settings/...`
 * routes render through it in the narrow view, and `SettingsWindow` in wide
 * windows, so both show the same page for the same address.
 */

export const SettingsGeneralPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-general-page");
    return { default: module.SettingsGeneralPage };
  }),
);
export const SettingsPluginsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-plugins-page");
    return { default: module.SettingsPluginsPage };
  }),
);
export const SettingsVaultPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-vault-page");
    return { default: module.SettingsVaultPage };
  }),
);
export const SettingsMcpPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-mcp-page");
    return { default: module.SettingsMcpPage };
  }),
);
export const SettingsAgentsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-agents-page");
    return { default: module.SettingsAgentsPage };
  }),
);
export const SettingsBacklogPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-backlog-page");
    return { default: module.SettingsBacklogPage };
  }),
);
export const SettingsCalendarPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-calendar-page");
    return { default: module.SettingsCalendarPage };
  }),
);
export const SettingsWorkflowPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-workflow-page");
    return { default: module.SettingsWorkflowPage };
  }),
);
export const SettingsProjectsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-projects-page");
    return { default: module.SettingsProjectsPage };
  }),
);
export const SettingsTimeEntriesPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-export-page");
    return { default: module.SettingsExportPage };
  }),
);
export const SettingsSyncReviewPage = lazy(
  trackPageChunk(async () => {
    const module =
      await import("@/features/settings/settings-import-review-page");
    return { default: module.SettingsImportReviewPage };
  }),
);
/** Debug exists only in development builds. */
export const SettingsDebugPage = import.meta.env.DEV
  ? lazy(
      trackPageChunk(async () => {
        const module = await import("@/features/settings/settings-debug-page");
        return { default: module.SettingsDebugPage };
      }),
    )
  : null;

/** Shows the page skeleton while a page's code loads. */
export function SettingsPageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

/** The page at a settings location, or null when no page lives there. */
export function settingsPageElement(location: SettingsLocation) {
  const { page, search } = location;
  switch (page) {
    case "general":
      return <SettingsGeneralPage />;
    case "plugins":
      return <SettingsPluginsPage />;
    case "vault":
      return <SettingsVaultPage />;
    case "mcp":
      return <SettingsMcpPage />;
    case "agents":
      return <SettingsAgentsPage />;
    case "backlog":
      return <SettingsBacklogPage />;
    case "calendar":
      return <SettingsCalendarPage />;
    case "workflow":
      return <SettingsWorkflowPage />;
    case "projects":
      return <SettingsProjectsPage />;
    case "time-entries":
      return <SettingsTimeEntriesPage />;
    case "sync-review":
      return <SettingsSyncReviewPage />;
    case "debug":
      return SettingsDebugPage ? <SettingsDebugPage /> : null;
  }
  const plugin = /^plugins\/([^/]+)$/.exec(page);
  if (plugin) {
    return (
      <SettingsPluginsPage
        pluginId={decodeURIComponent(plugin[1]!)}
        // The Vault's Replace names the secret to replace.
        replace={replaceTargetOf(parsePluginDetailSearch(search))}
      />
    );
  }
  return null;
}

/**
 * The page the settings window shows at `location`, with the location's
 * search as the page's own. An address with no page shows General.
 */
export function SettingsWindowPage({
  location,
}: {
  location: SettingsLocation;
}) {
  const element =
    settingsPageElement(location) ??
    settingsPageElement({ page: "general", search: {} });
  return (
    <SettingsSearchProvider value={location.search}>
      <SettingsPageSuspense>{element}</SettingsPageSuspense>
    </SettingsSearchProvider>
  );
}
