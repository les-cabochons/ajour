import {
  Navigate,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { lazy, Suspense, type ReactNode } from "react";
import { AppShell } from "@/features/layout/app-shell";
import { todayIsoDate } from "@/lib/utils";
import { EntryEditorPrototypePage } from "@/features/time/entry-editor-prototype-page";

const TimePage = lazy(async () => {
  const module = await import("@/features/time/time-page");
  return { default: module.TimePage };
});
const BacklogPage = lazy(async () => {
  const module = await import("@/features/backlog/backlog-page");
  return { default: module.BacklogPage };
});
const ProjectsPage = lazy(async () => {
  const module = await import("@/features/projects/projects-page");
  return { default: module.ProjectsPage };
});
const SettingsLayout = lazy(async () => {
  const module = await import("@/features/settings/settings-layout");
  return { default: module.SettingsLayout };
});
const SettingsGeneralPage = lazy(async () => {
  const module = await import("@/features/settings/settings-general-page");
  return { default: module.SettingsGeneralPage };
});
const SettingsPluginsPage = lazy(async () => {
  const module = await import("@/features/settings/settings-connectors-page");
  return { default: module.SettingsPluginsPage };
});
const SettingsBacklogPage = lazy(async () => {
  const module = await import("@/features/settings/settings-backlog-page");
  return { default: module.SettingsBacklogPage };
});
const SettingsProjectsPage = lazy(async () => {
  const module = await import("@/features/settings/settings-projects-page");
  return { default: module.SettingsProjectsPage };
});
const SettingsTimeEntriesPage = lazy(async () => {
  const module = await import("@/features/settings/settings-export-page");
  return { default: module.SettingsExportPage };
});
const SettingsSyncReviewPage = lazy(async () => {
  const module =
    await import("@/features/settings/settings-import-review-page");
  return { default: module.SettingsImportReviewPage };
});
const SettingsDebugPage = lazy(async () => {
  const module = await import("@/features/settings/settings-debug-page");
  return { default: module.SettingsDebugPage };
});

const RouterDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const module = await import("@tanstack/router-devtools");
      return { default: module.TanStackRouterDevtools };
    })
  : null;

function RootComponent() {
  return (
    <>
      <Outlet />
      {RouterDevtools ? (
        <Suspense fallback={null}>
          <RouterDevtools />
        </Suspense>
      ) : null}
    </>
  );
}

function RouteSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
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

// PROTOTYPE (issue #14): throwaway entry editor route.
const entryEditorPrototypeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/prototype/entry-editor",
  component: EntryEditorPrototypePage,
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
  component: () => <Navigate to="/settings/general" replace />,
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

const settingsBacklogRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/backlog",
  component: () => (
    <RouteSuspense>
      <SettingsBacklogPage />
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
  component: () => (
    <RouteSuspense>
      <SettingsSyncReviewPage />
    </RouteSuspense>
  ),
});

const settingsDebugRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/debug",
  component: () => (
    <RouteSuspense>
      <SettingsDebugPage />
    </RouteSuspense>
  ),
});

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
    entryEditorPrototypeRoute,
    backlogRoute,
    projectsRoute,
    projectsArchiveRoute,
    projectDetailRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      settingsGeneralRoute,
      settingsPluginsRoute,
      settingsPluginDetailRoute,
      settingsBacklogRoute,
      settingsProjectsRoute,
      settingsTimeEntriesRoute,
      settingsSyncReviewRoute,
      settingsDebugRoute,
    ]),
  ]),
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
