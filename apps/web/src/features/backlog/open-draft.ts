/**
 * The backlog page's side panel draft, for code that leaves the page from
 * elsewhere, such as a toast or a sidebar mark: it saves a valid draft
 * first, and a draft it cannot save keeps the user where they are.
 */
type Guard = () => boolean | Promise<boolean>;

let guard: Guard | undefined;

/** The backlog page sets its guard while it is open. */
export function setOpenDraftGuard(next: Guard) {
  guard = next;
  return () => {
    if (guard === next) guard = undefined;
  };
}

/** Whether the user may leave: true once an open draft is saved, or when none is open. */
export async function leaveOpenDraft() {
  return (await guard?.()) ?? true;
}
