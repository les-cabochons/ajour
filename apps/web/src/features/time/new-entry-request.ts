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
  values?: NewTimeEntryValues;
  /**
   * The row or button the popover anchors to. Null anchors it to the
   * titlebar's totals.
   */
  anchor: HTMLElement | null;
}

/** Only what the anchor rule reads from a DOM element, so it runs in unit tests without a DOM. */
export interface AnchorCandidate {
  getBoundingClientRect(): Pick<DOMRect, "top" | "right" | "bottom" | "left">;
}

/** A visible area in viewport coordinates: the window, or a scroll container. */
export type ClipRect = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

/**
 * The row to anchor the popover to, when any of it shows inside every clip rect
 * (the viewport and each scroll container around the row). Otherwise null, and
 * the popover falls back to the titlebar's totals. A row can be missing or
 * scrolled away when the request comes from the command palette.
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
 * New entry… on a task or a backlog item. Opens the entry editor in the
 * titlebar's popover, anchored to `button` when the request came from one,
 * else to the object's row while that row shows on screen, otherwise to the
 * titlebar's totals. The narrow view opens the full-width dialog instead.
 * Does nothing until the titlebar has mounted.
 */
export function openNewEntryEditor(
  object: NewEntryObjectRef,
  values: NewTimeEntryValues,
  button?: HTMLElement,
) {
  const row = button ?? findObjectRow(object);
  const anchor = row ? pickOnScreenAnchor(row, getClipRects(row)) : null;
  requestListener?.({ values, anchor });
}

/** A blank new entry, anchored to the button that requested it. */
export function openBlankEntryEditor(anchor: HTMLElement) {
  requestListener?.({ anchor });
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

/** The Time page's own path, "/time/<date>", not its commit page. */
export function isTimePagePath(pathname: string) {
  return /^\/time\/[^/]+\/?$/.test(pathname);
}

/**
 * A page host for one kind of request: the Time page registers it once it
 * has mounted. The page loads lazily, after the dock and the sidebar, so a
 * request made on its path before then waits for it instead of opening the
 * dock's popover, which left two entry editors open once the page opened
 * its own (forms council round 16).
 */
function createPageHost<T>() {
  let listener: ((request: T) => void) | null = null;
  let pending: { request: T } | null = null;
  return {
    register(next: (request: T) => void) {
      listener = next;
      const held = pending;
      pending = null;
      if (held) next(held.request);
      return () => {
        if (listener === next) listener = null;
      };
    },
    drop() {
      pending = null;
    },
    /** True when the page takes the request, now or once it is ready. */
    request(pathname: string, request: T) {
      if (!isTimePagePath(pathname)) {
        pending = null;
        return false;
      }
      if (listener) listener(request);
      else pending = { request };
      return true;
    },
  };
}

const newEntryPageHost = createPageHost<NewTimeEntryValues | undefined>();
const runningEntryPageHost = createPageHost<string>();

/**
 * Forgets what waited for the Time page once the user is somewhere else, so
 * it never opens later, on another visit.
 */
export function dropHeldPageRequests(pathname: string) {
  if (isTimePagePath(pathname)) return;
  newEntryPageHost.drop();
  runningEntryPageHost.drop();
}

/** Registers the Time page as the place new entries open. Returns its unregister. */
export function registerNewEntryPageHost(
  listener: (values?: NewTimeEntryValues) => void,
) {
  return newEntryPageHost.register(listener);
}

/**
 * The page that creates entries in its own side panel, the Time page, while
 * it is open. A new entry asked for anywhere on that page opens there, so one
 * job has one place (forms council round 4).
 */
export function useNewEntryPageHost(
  listener: (values?: NewTimeEntryValues) => void,
) {
  useEffect(() => registerNewEntryPageHost(listener), [listener]);
}

/**
 * Sends a new entry to the Time page when `pathname` is that page, at once
 * or as soon as it has loaded. False elsewhere: the popover opens it.
 */
export function requestNewEntryOnPage(
  pathname: string,
  values?: NewTimeEntryValues,
) {
  return newEntryPageHost.request(pathname, values);
}

/** Registers the Time page as the place the running entry opens. */
export function registerRunningEntryPageHost(
  listener: (timerId: string) => void,
) {
  return runningEntryPageHost.register(listener);
}

/**
 * The Time page, while open, edits the running entry in its side panel, as
 * a click on its row does; the dock sends its click there (forms council
 * round 5). Elsewhere the dock opens its popover.
 */
export function useRunningEntryPageHost(listener: (timerId: string) => void) {
  useEffect(() => registerRunningEntryPageHost(listener), [listener]);
}

/** As `requestNewEntryOnPage`, for the running entry's editor. */
export function requestRunningEntryOnPage(pathname: string, timerId: string) {
  return runningEntryPageHost.request(pathname, timerId);
}
