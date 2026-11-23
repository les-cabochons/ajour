import { useEffect, useState } from "react";
import {
  handoffTemplateDefaults,
  type HandoffTemplates,
} from "@ajour/shared/handoff-templates";
import { getHandoffTemplates } from "@/lib/app-api";

/**
 * A handoff plugin's saved templates, for the dialogs that show what a
 * hand off will send before it starts. Undefined until the local API
 * answers. A failed read gives the default templates, with why.
 */
export function useHandoffTemplates(pluginId: string) {
  const [templates, setTemplates] = useState<HandoffTemplates>();
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let live = true;
    void getHandoffTemplates(pluginId)
      .then((value) => {
        if (live) setTemplates(value);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(
          error instanceof Error && error.message
            ? error.message
            : "Could not load the templates.",
        );
        setTemplates(handoffTemplateDefaults());
      });
    return () => {
      live = false;
    };
  }, [pluginId]);
  return { templates, loadError };
}
