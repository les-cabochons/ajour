import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

/**
 * Search params that ask a page to run one of its object actions, such as
 * `/backlog?action=edit&target=<item id>`. The command palette uses them for
 * actions that need the page's editor, confirmation or undo, so each action
 * keeps one runner. `target` names the object when the route does not.
 */
export interface ActionRequest {
  action: string;
  target?: string;
}

/**
 * Runs `handler` once for each action request in the URL, then removes the
 * request from the URL. `ready` defers the request while the page settles, for
 * example while it saves a draft that belongs to the previous route.
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
  };
  const navigate = useNavigate();
  const handlerRef = useRef(handler);
  // React runs effects twice in development; this keeps the action single.
  const handledKeyRef = useRef<string | null>(null);
  const action = typeof search.action === "string" ? search.action : undefined;
  const target = typeof search.target === "string" ? search.target : undefined;

  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!action) {
      handledKeyRef.current = null;
      return;
    }

    const key = `${action}\n${target ?? ""}`;
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
      })) as never,
      replace: true,
    });
    handlerRef.current({ action, target });
  }, [action, navigate, ready, target]);
}
