import type { AnyRouter } from "@tanstack/react-router";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import { wideEvents } from "@/lib/wide-events";

/*
 * Route changes as wide events (#310): one `route.change` per navigation,
 * through the router's own events. A route is named by its ID, which is its
 * pattern, such as `/app/backlog/$itemId`: a parameter's value never enters
 * the event. A navigation that another one replaces before its page renders,
 * as a redirect does, is the same event, marked `redirected`.
 */

interface Navigation {
  router: AnyRouter;
  unit: Unit<AjourCatalog, "route.change">;
  startedAt: number;
  fromId?: string;
  toId?: string;
  /** The path the navigation goes to now, which its render must match. */
  toPath: string;
  redirectedFromId?: string;
  resolvedAt?: number;
  renderedAt?: number;
  /** Page code chunks still loading, and when the first began and the last ended. */
  chunks: number;
  chunkStartedAt?: number;
  chunkEndedAt?: number;
}

/** The navigation whose page has not rendered or loaded its code yet. */
let open: Navigation | undefined;
/** The route the last navigation rendered. */
let lastRouteId: string | undefined;

/** The ID of the route a path resolves to, or undefined when none matches. */
function routeIdOf(router: AnyRouter, pathname: string): string | undefined {
  try {
    const id = router.getMatchedRoutes(pathname).foundRoute?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** The app's section: the first segment of the route's path, when it is not a parameter. */
function sectionOf(router: AnyRouter, routeId: string | undefined) {
  if (!routeId) return undefined;
  const fullPath: unknown = (
    router.routesById as Record<string, { fullPath?: unknown } | undefined>
  )[routeId]?.fullPath;
  if (typeof fullPath !== "string") return undefined;
  const first = fullPath.split("/").find(Boolean);
  return first && !first.startsWith("$") ? first : undefined;
}

/** The navigation's routes resolved and its root rendered. */
function shown(navigation: Navigation) {
  return (
    navigation.resolvedAt !== undefined && navigation.renderedAt !== undefined
  );
}

/** Ends the navigation once its page showed and its code loaded. */
function finishWhenShown(navigation: Navigation) {
  if (shown(navigation) && navigation.chunks === 0) finish(navigation);
}

function finish(navigation: Navigation, ending?: "superseded") {
  if (open === navigation) open = undefined;
  lastRouteId = navigation.toId;
  const { router } = navigation;
  const { resolvedAt, renderedAt, chunkStartedAt, chunkEndedAt } = navigation;
  navigation.unit.set({
    route: {
      from_id: navigation.fromId,
      to_id: navigation.toId,
      section: sectionOf(router, navigation.toId),
      redirected: navigation.redirectedFromId !== undefined,
      redirected_from_id: navigation.redirectedFromId,
      resolve_ms:
        resolvedAt === undefined
          ? undefined
          : resolvedAt - navigation.startedAt,
      render_ms:
        renderedAt === undefined || resolvedAt === undefined
          ? undefined
          : Math.max(0, renderedAt - resolvedAt),
      chunk_ms:
        chunkStartedAt === undefined || chunkEndedAt === undefined
          ? undefined
          : chunkEndedAt - chunkStartedAt,
    },
  });
  if (ending) navigation.unit.end("cancelled", ending);
  else navigation.unit.end();
}

/**
 * Emits one `route.change` per navigation of `router`, from its start until
 * its page rendered and the page's code loaded. A change of the search or
 * hash alone is none. Returns a function that stops watching.
 */
export function watchRouteChanges(router: AnyRouter): () => void {
  const stops = [
    router.subscribe("onBeforeNavigate", (event) => {
      if (event.fromLocation && !event.pathChanged) return;
      const toPath = event.toLocation.pathname;
      const toId = routeIdOf(router, toPath);
      if (open && !shown(open)) {
        // Replaced before its page showed: a redirect.
        open.redirectedFromId ??= open.toId ?? "unknown";
        open.toId = toId;
        open.toPath = toPath;
        open.resolvedAt = undefined;
        open.renderedAt = undefined;
        return;
      }
      // Shown, but its code still loads: the user went on.
      if (open) finish(open, "superseded");
      open = {
        router,
        unit: wideEvents.start("route.change", {
          kind: "navigation",
          // The first navigation is the app's own, at boot.
          trigger: event.fromLocation ? "user" : "boot",
          detached: true,
        }),
        startedAt: Date.now(),
        fromId: lastRouteId,
        toId,
        toPath,
        chunks: 0,
      };
    }),
    // The router commits the routes it resolved, and renders the root, in
    // either order: the page shows once both happened for where it goes.
    router.subscribe("onResolved", (event) => {
      const navigation = open;
      if (navigation && event.toLocation.pathname === navigation.toPath) {
        navigation.resolvedAt ??= Date.now();
        finishWhenShown(navigation);
      }
    }),
    router.subscribe("onRendered", (event) => {
      const navigation = open;
      if (navigation && event.toLocation.pathname === navigation.toPath) {
        navigation.renderedAt ??= Date.now();
        finishWhenShown(navigation);
      }
    }),
  ];
  return () => {
    for (const stop of stops) stop();
    open = undefined;
    lastRouteId = undefined;
  };
}

/**
 * Wraps a lazy page's loader, so the navigation that first shows the page
 * waits for its code and records how long it took to load.
 */
export function trackPageChunk<Module>(
  load: () => Promise<Module>,
): () => Promise<Module> {
  return () => {
    const navigation = open;
    if (!navigation) return load();
    navigation.chunks += 1;
    navigation.chunkStartedAt ??= Date.now();
    return load().finally(() => {
      navigation.chunks -= 1;
      navigation.chunkEndedAt = Date.now();
      finishWhenShown(navigation);
    });
  };
}
