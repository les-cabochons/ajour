/**
 * Focus that an action can lose: a row that leaves its list, a button that
 * unmounts with its editor, a dialog that gives focus back to an element that
 * is gone. When focus falls to the page, the next single key acts on the page
 * instead of on what the user worked on. These put it back (usability testing,
 * 2026-11-06). See "Focus after an action" in docs/agents/ux-spec.md.
 */

import { isIgnoredPress } from "@/lib/double-click-guard";

/** How long a dialog or popover may take to give focus back as it closes. */
const SETTLE_MS = 400;

/** True when nothing has focus but the page: the body, or a removed element. */
export function isFocusLost(doc: Document = document) {
  const active = doc.activeElement;
  return !active || active === doc.body || !active.isConnected;
}

/**
 * Once the change has rendered, focuses what `find` returns when focus fell to
 * the page meanwhile. Focus the user, a dialog or a field put elsewhere stays
 * there. It checks again on each frame for a short while, since a closing
 * dialog can give focus back to a removed element after React has rendered,
 * and stops at the user's next key or press, except the second press of a
 * double-click that `ignoreSecondClick` drops.
 */
export function focusWhenLost(find: () => HTMLElement | null | undefined) {
  const doc = document;
  const view = doc.defaultView ?? window;
  const start = view.performance.now();
  let done = false;
  const stop = () => {
    done = true;
    view.removeEventListener("keydown", stop, true);
    view.removeEventListener("mousedown", stopAtPress, true);
  };
  // A press is a mousedown, which carries the click count the double-click
  // guard needs; a pointerdown does not.
  const stopAtPress = (event: MouseEvent) => {
    if (!isIgnoredPress(event)) stop();
  };
  view.addEventListener("keydown", stop, true);
  view.addEventListener("mousedown", stopAtPress, true);

  const attempt = () => {
    if (done) return;
    if (isFocusLost(doc)) {
      // A dialog closing later can drop it again, so it keeps watching.
      const target = find();
      if (target?.isConnected) target.focus();
    }
    if (view.performance.now() - start > SETTLE_MS) {
      stop();
      return;
    }
    view.requestAnimationFrame(attempt);
  };
  // React renders a key or click's change before microtasks run, so the
  // first try already sees it.
  queueMicrotask(attempt);
}
