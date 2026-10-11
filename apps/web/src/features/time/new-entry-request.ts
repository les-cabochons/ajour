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

/** A visible area in viewport coordinates: the window, or a scroll container. */
export type ClipRect = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

/**
 * The row to anchor the popover to, when any of it shows inside every clip
 * rect (the viewport and each scroll container around the row). Otherwise
 * null, and the popover falls back to the titlebar "+". A row can be missing
 * or scrolled away when the request comes from the command palette.
 */
export function pickOnScreenAnchor<T extends AnchorCandidate>(
  candidate: T | null | undefined,
  clipRects: ClipRect[],
): T | null {
  if (!candidate) {
    return null;
  }

  const visible = clipRects.reduce<ClipRect>(
    (area, clip) => ({
      top: Math.max(area.top, clip.top),
      left: Math.max(area.left, clip.left),
      bottom: Math.min(area.bottom, clip.bottom),
      right: Math.min(area.right, clip.right),
    }),
    candidate.getBoundingClientRect(),
  );
  return visible.bottom > visible.top && visible.right > visible.left
    ? candidate
    : null;
}

/** The viewport plus every ancestor that clips its overflow, such as a ScrollArea viewport. */
function getClipRects(element: HTMLElement): ClipRect[] {
  const rects: ClipRect[] = [
    { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth },
  ];
  for (
    let ancestor = element.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      rects.push(ancestor.getBoundingClientRect());
    }
  }
  return rects;
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
  const row = findObjectRow(object);
  const anchor = row ? pickOnScreenAnchor(row, getClipRects(row)) : null;
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
