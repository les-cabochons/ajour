import { useEffect, useState } from "react";
import type { SelectOption } from "@/components/ui/option-select";
import type {
  CommitsAsChoice,
  TaskPropertyPlugin,
} from "@/domain/projects/plugin-properties";
import { listTaskPropertyPlugins } from "@/lib/plugin-project-properties";

/** The Commits as menu, with short labels: the user docs explain each one. */
export const COMMITS_AS_OPTIONS: SelectOption<CommitsAsChoice>[] = [
  { value: "own", label: "Its own name" },
  { value: "another", label: "Another task…" },
  { value: "waiting", label: "Not known yet" },
  { value: "local", label: "Local only" },
];

/**
 * The active plugins that add task properties, loaded once. Empty while
 * they load, when the overview fails and without the local API.
 */
export function useTaskPropertyPlugins(): TaskPropertyPlugin[] {
  const [plugins, setPlugins] = useState<TaskPropertyPlugin[]>([]);
  useEffect(() => {
    let active = true;
    void listTaskPropertyPlugins()
      .then((next) => active && setPlugins(next))
      // The overview call's own event records the failure.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return plugins;
}
