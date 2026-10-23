import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { withEventAttribution } from "@/lib/wide-events";
import type { Surface } from "@ajour/wide-events";

/**
 * Search params that ask a page to run one of its actions, such as
 * `/backlog?action=edit&target=<item id>`. The command palette uses them for
 * actions that need the page's editor, confirmation or navigation guard, so
 * each action keeps one runner. `target` names the object when the route does
 * not, and `parent` the object that holds it, such as a task's project.
 */
export interface ActionRequest {
  action: string;
  target?: string;
  parent?: string;
  surface?: Surface;
}

/**
 * Runs `handler` once for each action request in the URL, then removes the
 * request from the URL. `ready` defers the request until the page can run it.
 *
 * The URL is outside input: the handler must look the target up and check the
 * action against the object's current action set before running it.
 */
export function useActionRequest(
  handler: (request: ActionRequest) => void,
  ready = true,
) {
  const search = useSearch({ strict: false }) as {
    action?: unknown;
    target?: unknown;
    parent?: unknown;
    surface?: unknown;
  };
  const navigate = useNavigate();
  const handlerRef = useRef(handler);
  // React runs effects twice in development; this keeps the action single.
  const handledKeyRef = useRef<string | null>(null);
  const action = typeof search.action === "string" ? search.action : undefined;
  const target = typeof search.target === "string" ? search.target : undefined;
  const parent = typeof search.parent === "string" ? search.parent : undefined;
  const surface = search.surface === "palette" ? "palette" : undefined;

  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!action) {
      handledKeyRef.current = null;
      return;
    }

    const key = [action, target, parent].join("\n");
    if (!ready || handledKeyRef.current === key) {
      return;
    }

    handledKeyRef.current = key;
    void navigate({
      to: ".",
      search: ((previous: Record<string, unknown>) => ({
        ...previous,
        action: undefined,
        target: undefined,
        parent: undefined,
        surface: undefined,
      })) as never,
      replace: true,
    });
    withEventAttribution(surface ? { surface } : {}, () =>
      handlerRef.current({ action, target, parent, surface }),
    );
  }, [action, navigate, parent, ready, surface, target]);
}
