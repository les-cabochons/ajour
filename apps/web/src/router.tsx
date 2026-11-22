import {
  Navigate,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { parseSyncReviewSearch } from "@/features/backlog/sync-conflicts";
import {
  parsePluginDetailSearch,
  replaceTargetOf,
} from "@/features/settings/plugin-detail-search";
import {
  getLastAppLocation,
  settingsLocationOf,
  settingsWindowRedirect,
} from "@/features/settings/settings-location";
import {
  SettingsAgentsPage,
  SettingsBacklogPage,
  SettingsCalendarPage,
  SettingsDebugPage,
  SettingsDiagnosticsPage,
  shownSettingsLocation,
  SettingsGeneralPage,
  SettingsMcpPage,
  SettingsPluginsPage,
  SettingsProjectsPage,
  SettingsSyncReviewPage,
  SettingsTimeEntriesPage,
  SettingsVaultPage,
  SettingsWhatsNewPage,
  SettingsWorkflowPage,
} from "@/features/settings/settings-pages";
import { hasLocalLogsBridge } from "@/features/settings/use-local-logs";
import { isNarrowView } from "@/lib/use-narrow-view";
import { lazy, Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { parseBacklogItemSearch } from "@/features/backlog/backlog-item-search";
import { AppShell } from "@/features/layout/app-shell";
import { trackPageChunk, watchRouteChanges } from "@/lib/route-events";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { todayIsoDate } from "@/lib/utils";

const TimePage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/time/time-page");
    return { default: module.TimePage };
  }),
);
const CommitPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/time/commit-page");
    return { default: module.CommitPage };
  }),
);
const BacklogPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/backlog/backlog-page");
    return { default: module.BacklogPage };
  }),
);
const DeckPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/deck/deck-page");
    return { default: module.DeckPage };
  }),
);
const BacklogItemPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/backlog/backlog-item-page");
    return { default: module.BacklogItemPage };
  }),
);
const ProjectsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/projects/projects-page");
    return { default: module.ProjectsPage };
  }),
);
const SettingsLayout = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-layout");
    return { default: module.SettingsLayout };
  }),
);
const SettingsIndex = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-layout");
    return { default: module.SettingsIndex };
  }),
);
const RouterDevtools =
  import.meta.env.DEV && import.meta.env.MODE !== "test"
    ? lazy(async () => {
        const module = await import("@tanstack/router-devtools");
        return { default: module.TanStackRouterDevtools };
      })
    : null;

function RootComponent() {
  return (
    <ShortcutProvider>
      <Outlet />
      {RouterDevtools ? (
        <Suspense fallback={null}>
          <RouterDevtools />
        </Suspense>
      ) : null}
    </ShortcutProvider>
  );
}

/** Shows the page skeleton while a route's code loads. */
function RouteSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

const rootRoute = createRootRoute({
  component: RootComponent,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => {
    return <Navigate to="/time/$date" params={{ date: "today" }} />;
  },
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppShell,
});

const timeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/time/$date",
  component: () => {
    const params = timeRoute.useParams();
    return (
      <RouteSuspense>
        <TimePage
          date={params.date === "today" ? todayIsoDate() : params.date}
        />
      </RouteSuspense>
    );
  },
});

const commitRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/time/$date/commit",
  component: () => {
    const params = commitRoute.useParams();
    const search = commitRoute.useSearch() as { view?: string };
    return (
      <RouteSuspense>
        <CommitPage
          date={params.date === "today" ? todayIsoDate() : params.date}
          returnView={search.view === "week" ? "week" : undefined}
        />
      </RouteSuspense>
    );
  },
});

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects",
  component: () => (
    <RouteSuspense>
      <ProjectsPage />
    </RouteSuspense>
  ),
});

const deckRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/deck",
  component: () => (
    <RouteSuspense>
      <DeckPage />
    </RouteSuspense>
  ),
});
const deckItemRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/deck/$itemId",
  component: () => (
    <RouteSuspense>
      <DeckPage itemId={deckItemRoute.useParams().itemId} />
    </RouteSuspense>
  ),
});

const projectsArchiveRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/archive",
  component: () => (
    <RouteSuspense>
      <ProjectsPage />
    </RouteSuspense>
  ),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId",
  component: () => (
    <RouteSuspense>
      <ProjectsPage />
    </RouteSuspense>
  ),
});

const backlogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/backlog",
  component: () => (
    <RouteSuspense>
      <BacklogPage />
    </RouteSuspense>
  ),
});

const backlogItemRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/backlog/$itemId",
  validateSearch: parseBacklogItemSearch,
  component: () => {
    const { itemId } = backlogItemRoute.useParams();
    return (
      <RouteSuspense>
        <BacklogItemPage itemId={itemId} />
      </RouteSuspense>
    );
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  // In wide windows Settings is a window over the last page outside it
  // (`SettingsWindow`): the route becomes that page's location with the
  // window open, shown as this route through a mask. The narrow view keeps
  // these routes as pages.
  beforeLoad: ({ location }) => {
    if (isNarrowView()) return;
    const window = settingsWindowRedirect(
      getLastAppLocation(),
      shownSettingsLocation(
        settingsLocationOf(
          location.pathname,
          location.search as Record<string, unknown>,
        ),
      ),
    );
    throw redirect({
      to: window.to as never,
      search: window.search as never,
      mask: window.mask as never,
      replace: true,
    });
  },
  component: () => (
    <RouteSuspense>
      <SettingsLayout />
    </RouteSuspense>
  ),
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  component: () => (
    <RouteSuspense>
      <SettingsIndex />
    </RouteSuspense>
  ),
});

const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/general",
  component: () => (
    <RouteSuspense>
      <SettingsGeneralPage />
    </RouteSuspense>
  ),
});

const settingsPluginsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/plugins",
  component: () => (
    <RouteSuspense>
      <SettingsPluginsPage />
    </RouteSuspense>
  ),
});

const settingsPluginDetailRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/plugins/$pluginId",
  // The Vault's Replace names the secret to replace.
  validateSearch: parsePluginDetailSearch,
  component: () => {
    const { pluginId } = settingsPluginDetailRoute.useParams();
    const search = settingsPluginDetailRoute.useSearch();
    return (
      <RouteSuspense>
        <SettingsPluginsPage
          pluginId={pluginId}
          replace={replaceTargetOf(search)}
        />
      </RouteSuspense>
    );
  },
});

const settingsVaultRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/vault",
  component: () => (
    <RouteSuspense>
      <SettingsVaultPage />
    </RouteSuspense>
  ),
});

const settingsMcpRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/mcp",
  component: () => (
    <RouteSuspense>
      <SettingsMcpPage />
    </RouteSuspense>
  ),
});

const settingsAgentsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/agents",
  component: () => (
    <RouteSuspense>
      <SettingsAgentsPage />
    </RouteSuspense>
  ),
});

const settingsDiagnosticsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/diagnostics",
  // Desktop only: the web build has no log file (#438).
  beforeLoad: () => {
    if (!hasLocalLogsBridge()) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: () => (
    <RouteSuspense>
      <SettingsDiagnosticsPage />
    </RouteSuspense>
  ),
});

const settingsBacklogRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/backlog",
  component: () => (
    <RouteSuspense>
      <SettingsBacklogPage />
    </RouteSuspense>
  ),
});

const settingsCalendarRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/calendar",
  component: () => (
    <RouteSuspense>
      <SettingsCalendarPage />
    </RouteSuspense>
  ),
});

const settingsWorkflowRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/workflow",
  component: () => (
    <RouteSuspense>
      <SettingsWorkflowPage />
    </RouteSuspense>
  ),
});

const settingsTimeEntriesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/time-entries",
  component: () => (
    <RouteSuspense>
      <SettingsTimeEntriesPage />
    </RouteSuspense>
  ),
});

const settingsSyncReviewRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/sync-review",
  validateSearch: parseSyncReviewSearch,
  component: () => (
    <RouteSuspense>
      <SettingsSyncReviewPage />
    </RouteSuspense>
  ),
});

const settingsWhatsNewRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/whats-new",
  component: () => (
    <RouteSuspense>
      <SettingsWhatsNewPage />
    </RouteSuspense>
  ),
});

const settingsDebugRoutes = SettingsDebugPage
  ? [
      createRoute({
        getParentRoute: () => settingsRoute,
        path: "/debug",
        component: () => {
          if (!SettingsDebugPage) return null;
          return (
            <RouteSuspense>
              <SettingsDebugPage />
            </RouteSuspense>
          );
        },
      }),
    ]
  : [];

const settingsProjectsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/projects",
  component: () => (
    <RouteSuspense>
      <SettingsProjectsPage />
    </RouteSuspense>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  appRoute.addChildren([
    timeRoute,
    commitRoute,
    backlogRoute,
    backlogItemRoute,
    deckRoute,
    deckItemRoute,
    projectsRoute,
    projectsArchiveRoute,
    projectDetailRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      settingsGeneralRoute,
      settingsPluginsRoute,
      settingsPluginDetailRoute,
      settingsVaultRoute,
      settingsMcpRoute,
      settingsAgentsRoute,
      settingsDiagnosticsRoute,
      settingsBacklogRoute,
      settingsWorkflowRoute,
      settingsCalendarRoute,
      settingsProjectsRoute,
      settingsTimeEntriesRoute,
      settingsSyncReviewRoute,
      settingsWhatsNewRoute,
      ...settingsDebugRoutes,
    ]),
  ]),
]);

const router = createRouter({ routeTree });
watchRouteChanges(router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
