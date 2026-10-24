import type { ComponentType, FunctionComponent, ReactNode } from "react";
import { webcrypto } from "node:crypto";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";

/**
 * What jsdom lacks and the app's components read: media queries, resize
 * observers, pointer capture and scrolling. Call it once, from a
 * `// @vitest-environment jsdom` test file.
 */
export function installDomShims() {
  vi.stubGlobal("crypto", webcrypto);
  if (!window.localStorage) {
    // Recent Node versions define a localStorage global that hides jsdom's.
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        clear: () => values.clear(),
      },
    });
  }
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  // jsdom defines it, but only to report "Not implemented" on every call.
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}

/**
 * Renders `routes` inside a memory router, with `shell` around every route.
 * Resolves once the first route has rendered.
 */
export async function renderRoutes({
  shell: Shell = ({ children }: { children: ReactNode }) => <>{children}</>,
  routes,
  path = "/",
}: {
  shell?: ComponentType<{ children: ReactNode }>;
  routes: Record<string, FunctionComponent>;
  path?: string;
}) {
  const root = createRootRoute({
    component: () => (
      <Shell>
        <Outlet />
      </Shell>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren(
      Object.entries(routes).map(([routePath, component]) =>
        createRoute({ getParentRoute: () => root, path: routePath, component }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const view = await act(async () =>
    render(<RouterProvider router={router} />),
  );
  return { router, ...view };
}

/** Makes the window report the narrow view (below 768px), or the full one. */
export function stubNarrowView(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}
