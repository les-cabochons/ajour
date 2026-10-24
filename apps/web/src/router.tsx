import {
  Navigate,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { parseSyncReviewSearch } from "@/features/backlog/sync-conflicts";
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
const PullRequestsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/pull-requests/pull-requests-page");
    return { default: module.PullRequestsPage };
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
const SettingsGeneralPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-general-page");
    return { default: module.SettingsGeneralPage };
  }),
);
const SettingsPluginsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-plugins-page");
    return { default: module.SettingsPluginsPage };
  }),
);
const SettingsMcpPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-mcp-page");
    return { default: module.SettingsMcpPage };
  }),
);
const SettingsAgentsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-agents-page");
    return { default: module.SettingsAgentsPage };
  }),
);

const SettingsBacklogPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-backlog-page");
    return { default: module.SettingsBacklogPage };
  }),
);
const SettingsCalendarPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-calendar-page");
    return { default: module.SettingsCalendarPage };
  }),
);
const SettingsWorkflowPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-workflow-page");
    return { default: module.SettingsWorkflowPage };
  }),
);
const SettingsProjectsPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-projects-page");
    return { default: module.SettingsProjectsPage };
  }),
);
const SettingsTimeEntriesPage = lazy(
  trackPageChunk(async () => {
    const module = await import("@/features/settings/settings-export-page");
    return { default: module.SettingsExportPage };
  }),
);
const SettingsSyncReviewPage = lazy(
  trackPageChunk(async () => {
    const module =
      await import("@/features/settings/settings-import-review-page");
    return { default: module.SettingsImportReviewPage };
  }),
);
// Debug exists only in development builds, so production omits its chunk.
const SettingsDebugPage = import.meta.env.DEV
  ? lazy(
      trackPageChunk(async () => {
        const module = await import("@/features/settings/settings-debug-page");
        return { default: module.SettingsDebugPage };
      }),
    )
  : null;

// Not in the acceptance run (`--mode test`): its corner button sits over the
// narrow view's navigation toggle and takes the clicks meant for it.
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

const pullRequestsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/pull-requests",
  component: () => (
    <RouteSuspense>
      <PullRequestsPage />
    </RouteSuspense>
  ),
});
const pullRequestDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/pull-requests/$itemId",
  component: () => (
    <RouteSuspense>
      <PullRequestsPage itemId={pullRequestDetailRoute.useParams().itemId} />
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
  component: () => {
    const { pluginId } = settingsPluginDetailRoute.useParams();
    return (
      <RouteSuspense>
        <SettingsPluginsPage pluginId={pluginId} />
      </RouteSuspense>
    );
  },
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

const settingsDebugRoutes = SettingsDebugPage
  ? [
      createRoute({
        getParentRoute: () => settingsRoute,
        path: "/debug",
        component: () => (
          <RouteSuspense>
            <SettingsDebugPage />
          </RouteSuspense>
        ),
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
    pullRequestsRoute,
    pullRequestDetailRoute,
    projectsRoute,
    projectsArchiveRoute,
    projectDetailRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      settingsGeneralRoute,
      settingsPluginsRoute,
      settingsPluginDetailRoute,
      settingsMcpRoute,
      settingsAgentsRoute,
      settingsBacklogRoute,
      settingsWorkflowRoute,
      settingsCalendarRoute,
      settingsProjectsRoute,
      settingsTimeEntriesRoute,
      settingsSyncReviewRoute,
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
