import { useSyncExternalStore } from "react";

/**
 * The frontmatter sections the user opened in backlog item properties, per
 * device (#281). A section is known by its keys from the top of the block,
 * ignoring case, so opening Links on one item opens it on every item. Like
 * the side panel widths, this lives outside the local app state.
 */

export const FRONTMATTER_SECTIONS_STORAGE_KEY = "ajour.frontmatter-sections";
/** The most recently opened sections kept; older ones close again. */
export const MAX_OPEN_FRONTMATTER_SECTIONS = 200;

/** The section a path of keys names, such as Client then Contact. */
export function getFrontmatterSectionId(path: readonly string[]) {
  // A quoted key can hold any character, so no separator is safe.
  return JSON.stringify(path.map((key) => key.toLowerCase()));
}

/** Unknown values are dropped; the newest sections are kept. */
export function parseOpenFrontmatterSections(value: string | null): string[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    return [...new Set(ids)].slice(-MAX_OPEN_FRONTMATTER_SECTIONS);
  } catch {
    return [];
  }
}

/** The open sections after opening or closing one. An opened one is the newest. */
export function toggleFrontmatterSection(
  openIds: readonly string[],
  id: string,
  open: boolean,
): string[] {
  const others = openIds.filter((openId) => openId !== id);
  return open ? [...others, id].slice(-MAX_OPEN_FRONTMATTER_SECTIONS) : others;
}

let openIds: string[] | undefined;
const listeners = new Set<() => void>();

function getOpenIds() {
  if (openIds === undefined) {
    try {
      openIds = parseOpenFrontmatterSections(
        window.localStorage.getItem(FRONTMATTER_SECTIONS_STORAGE_KEY),
      );
    } catch {
      // Storage can be unavailable under restrictive privacy settings.
      openIds = [];
    }
  }
  return openIds;
}

/** Opens or closes a section on this device. */
export function setFrontmatterSectionOpen(id: string, open: boolean) {
  openIds = toggleFrontmatterSection(getOpenIds(), id, open);
  listeners.forEach((listener) => listener());
  try {
    window.localStorage.setItem(
      FRONTMATTER_SECTIONS_STORAGE_KEY,
      JSON.stringify(openIds),
    );
  } catch {
    // The sections then only stay open for this session.
  }
}

/** Whether the user left a section open on this device. Closed by default. */
export function useFrontmatterSectionOpen(id: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getOpenIds().includes(id),
    () => false,
  );
}
