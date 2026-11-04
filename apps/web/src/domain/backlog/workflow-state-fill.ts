import type { LocalWorkflowState } from "@/domain/local-state";

/**
 * How full each workflow state's mark is drawn, from 0 to 1, so a state reads
 * by its shape as well as its color, as in Linear (council round 14). The
 * first open state is an empty ring; later open states fill by their place,
 * up to three quarters, so none looks finished; a done state is whole.
 */
export function getWorkflowStateFills(
  states: readonly LocalWorkflowState[],
): Map<string, number> {
  const open = states.filter((state) => !state.done);
  const fills = new Map<string, number>();
  for (const state of states) {
    if (state.done) {
      fills.set(state._id, 1);
      continue;
    }
    const place = open.indexOf(state);
    fills.set(
      state._id,
      open.length <= 1 ? 0 : (place / (open.length - 1)) * 0.75,
    );
  }
  return fills;
}
