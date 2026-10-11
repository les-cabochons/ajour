import { useEffect } from "react";
import type { NewTimeEntryValues } from "@/features/time/time-entry-editor-form";
import { FOCUS_ATTRIBUTES } from "@/lib/focused-object";

/** A task or backlog item that New entry… logs time on. */
export type NewEntryObjectRef =
  | { kind: "task"; projectId: string; taskId: string }
  | { kind: "backlog-item"; workItemId: string };

/** A New entry… request for the titlebar's entry editor host. */
export interface NewEntryRequest {
  /** Project, task, note and backlog item link the form starts with. */
  values: NewTimeEntryValues;
  /** The row the popover anchors to. Null anchors it to the titlebar "+". */
  anchor: HTMLElement | null;
}

/** Only what the anchor rule reads from a DOM element, so it runs in unit tests without a DOM. */
export interface AnchorCandidate {
  getBoundingClientRect(): Pick<DOMRect, "top" | "right" | "bottom" | "left">;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * The row to anchor the popover to, when any of it shows in the viewport.
 * Otherwise null, and the popover falls back to the titlebar "+". A row can be
 * missing or scrolled away when the request comes from the command palette.
 */
export function pickOnScreenAnchor<T extends AnchorCandidate>(
  candidate: T | null | undefined,
  viewport: ViewportSize,
): T | null {
  if (!candidate) {
    return null;
  }

  const rect = candidate.getBoundingClientRect();
  const isOnScreen =
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewport.height &&
    rect.left < viewport.width &&
    rect.bottom > rect.top &&
    rect.right > rect.left;
  return isOnScreen ? candidate : null;
}

/** The row that shows `object`, such as a Projects task row or a Backlog row. */
function findObjectRow(object: NewEntryObjectRef) {
  const selector =
    object.kind === "task"
      ? `[${FOCUS_ATTRIBUTES.project}="${CSS.escape(object.projectId)}"] [${FOCUS_ATTRIBUTES.task}="${CSS.escape(object.taskId)}"]`
      : `[${FOCUS_ATTRIBUTES.backlogItem}="${CSS.escape(object.workItemId)}"]`;
  return document.querySelector<HTMLElement>(selector);
}

let requestListener: ((request: NewEntryRequest) => void) | null = null;

/**
 * New entry… on a task or a backlog item. Opens the entry editor in the titlebar's
 * popover, anchored to the object's row while that row shows on screen, otherwise
 * to the titlebar "+". The narrow view opens the full-width dialog instead. Does
 * nothing until the titlebar has mounted.
 */
export function openNewEntryEditor(
  object: NewEntryObjectRef,
  values: NewTimeEntryValues,
) {
  const anchor = pickOnScreenAnchor(findObjectRow(object), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  requestListener?.({ values, anchor });
}

/** Receives New entry… requests. Only the titlebar, which hosts the editor, listens. */
export function useNewEntryRequests(
  listener: (request: NewEntryRequest) => void,
) {
  useEffect(() => {
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, [listener]);
}
