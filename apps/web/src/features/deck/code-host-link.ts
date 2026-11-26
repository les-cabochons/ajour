import { createContext, useContext } from "react";

/*
 * The code host of the pull request on the review page, for a file it shows
 * without its lines: a file too large to compare links to it there.
 */

export interface CodeHostLink {
  /** The plugin's name, such as "GitHub", for "Open in GitHub". */
  pluginName: string;
  /** The pull request on the code host. */
  pullRequestUrl: string;
}

export const CodeHostLinkContext = createContext<CodeHostLink | null>(null);

/** The review page's code host, or null outside it. */
export function useCodeHostLink() {
  return useContext(CodeHostLinkContext);
}
