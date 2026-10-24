// @vitest-environment jsdom
import { lazy, Suspense } from "react";
import {
  Navigate,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { trackPageChunk, watchRouteChanges } from "@/lib/route-events";
import { replaceEventSink } from "@/lib/wide-events";
import { installDomShims } from "@/test-support/dom";

/*
 * Route changes through a real router, wired as router.tsx wires the app's:
 * one `route.change` per navigation, named by route IDs, never by the
 * values of their parameters.
 */

let sink: ReturnType<typeof createRecordingSink<AjourEvent>>;
let unwatch: () => void = () => undefined;

beforeAll(installDomShims);

beforeEach(() => {
  sink = createRecordingSink<AjourEvent>();
  replaceEventSink(sink);
});

afterEach(() => {
  unwatch();
  cleanup();
});

/** A router like the app's: an index that redirects, and a lazy item page. */
function createTestRouter() {
  const ItemPage = lazy(
    trackPageChunk(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { default: () => <p>Item page</p> };
    }),
  );
  const root = createRootRoute({ component: () => <Outlet /> });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => (
      <Navigate to="/backlog/$itemId" params={{ itemId: "canary-item" }} />
    ),
  });
  const item = createRoute({
    getParentRoute: () => root,
    path: "/backlog/$itemId",
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <ItemPage />
      </Suspense>
    ),
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component: () => <p>Settings</p>,
  });
  return createRouter({
    routeTree: root.addChildren([index, item, settings]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

const routeChanges = () =>
  sink.events.filter((event) => event.name === "route.change");

describe("route change events", () => {
  it("records the first navigation and its redirect as one event, until the page's code loaded", async () => {
    const router = createTestRouter();
    unwatch = watchRouteChanges(router);

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(routeChanges()).toHaveLength(1));

    expect(routeChanges()).toEqual([
      expect.objectContaining({
        kind: "navigation",
        runtime: "renderer",
        trigger: "boot",
        outcome: "ok",
        route: {
          to_id: "/backlog/$itemId",
          section: "backlog",
          redirected: true,
          redirected_from_id: "/",
          resolve_ms: expect.any(Number),
          render_ms: expect.any(Number),
          chunk_ms: expect.any(Number),
        },
      }),
    ]);
    expect(routeChanges()[0]!.route!.chunk_ms).toBeGreaterThanOrEqual(10);
  });

  it("records each later navigation from the route it left, and nothing for a search change", async () => {
    const router = createTestRouter();
    unwatch = watchRouteChanges(router);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(routeChanges()).toHaveLength(1));

    await act(() => router.navigate({ to: "/settings" }));
    await waitFor(() => expect(routeChanges()).toHaveLength(2));
    await act(() => router.navigate({ to: "/settings", search: { q: "x" } }));

    expect(routeChanges()).toHaveLength(2);
    expect(routeChanges()[1]).toMatchObject({
      trigger: "user",
      outcome: "ok",
      route: {
        from_id: "/backlog/$itemId",
        to_id: "/settings",
        section: "settings",
        redirected: false,
      },
    });
    // A parameter's value never enters an event.
    expect(JSON.stringify(sink.events)).not.toContain("canary-item");
  });
});
