import { createContext, useContext } from "react";

/** Subwindows share the owner's React tree, but their overlays belong to their own document. */
export const PortalContainer = createContext<HTMLElement | undefined>(
  undefined,
);
export function usePortalContainer() {
  return useContext(PortalContainer);
}
