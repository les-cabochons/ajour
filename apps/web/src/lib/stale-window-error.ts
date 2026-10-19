/**
 * A write Ajour refused because another window of this origin changed the
 * submitted weeks since this window last read them. The refusal refreshes
 * this window, so trying again works on the current state.
 */
export class StaleWindowError extends Error {
  constructor() {
    super("Ajour changed in another window. Try again.");
    this.name = "StaleWindowError";
  }
}
