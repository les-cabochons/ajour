import { useEffect, useRef, useState } from "react";
import {
  handoffToolFeatureLabels,
  handoffToolFeatures,
} from "@ajour/shared/handoffs";
import { SettingRow } from "@/components/app-surface";
import { Switch } from "@/components/ui/switch";
import { HANDOFF_TOOLS_SECTION } from "@/domain/handoffs/handoffs";
import {
  getHandoffToolSwitches,
  getPluginsOverview,
  setHandoffToolEnabled,
} from "@/lib/app-api";
import { forgetHandoffToolDetection } from "@/lib/handoff-tools";
import { useSettingsSearch } from "@/features/settings/settings-link";
import { useChooseHandoffToolsRequest } from "@/features/backlog/handoff-request";

interface Tool {
  id: string;
  label: string;
  followsState?: boolean;
  listsThreads?: boolean;
  hooks?: boolean;
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/**
 * The plugin's handoff tools on its page, each with the features it
 * supports (`handoffToolFeatures`) and its switch (#760). Every tool starts
 * off, per device; only a tool that is on takes hand offs, is detected and
 * offers found threads. Turning one off keeps its handoffs. *Choose your
 * tools* opens the page here, with `section=handoff-tools`: the section
 * scrolls into view and its heading takes focus, on each request.
 */
export function PluginHandoffTools({
  pluginId,
  tools,
}: {
  pluginId: string;
  tools: readonly Tool[];
}) {
  const [enabled, setEnabled] = useState<readonly string[]>();
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState("");
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useSettingsSearch().section === HANDOFF_TOOLS_SECTION;

  useEffect(() => {
    let live = true;
    setEnabled(undefined);
    setError("");
    void getHandoffToolSwitches(pluginId)
      .then((value) => {
        if (live) setEnabled(value.enabled);
      })
      .catch((reason: unknown) => {
        if (live)
          setError(errorMessage(reason, "Could not read the tools' switches."));
      });
    return () => {
      live = false;
    };
  }, [pluginId]);

  const request = useChooseHandoffToolsRequest();
  // The switches loaded, or failed to: the section has its height.
  const ready = enabled !== undefined || error !== "";
  // Once the switches load, and again after the next layout in case
  // something above grew meanwhile.
  useEffect(() => {
    if (!focused || !ready) return;
    const show = () => section.current?.scrollIntoView({ block: "start" });
    show();
    heading.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(show);
    return () => cancelAnimationFrame(frame);
  }, [focused, ready, request]);

  const toggle = async (toolId: string, on: boolean) => {
    setSaving(toolId);
    setError("");
    try {
      setEnabled((await setHandoffToolEnabled(pluginId, toolId, on)).enabled);
      // The hand-off menus list only tools that are on, and detect them.
      forgetHandoffToolDetection(pluginId);
      void getPluginsOverview().catch(() => undefined);
    } catch (reason) {
      setError(errorMessage(reason, "Could not save the tool's switch."));
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <section
      ref={section}
      className="settings-section"
      aria-labelledby={`${pluginId}-handoff-tools`}
    >
      <div>
        <h2
          ref={heading}
          id={`${pluginId}-handoff-tools`}
          tabIndex={-1}
          className="settings-section-title outline-none"
        >
          Handoff tools
        </h2>
        <p className="settings-section-desc mt-1">
          Turn on the tools you hand off to on this computer. Ajour uses only
          what a tool supports. Tools that run each other, such as T3 Code,
          which runs Codex and Claude Code threads, show the same work under
          each tool that is on.
        </p>
      </div>
      {tools.map((tool) => {
        const on = enabled?.includes(tool.id) ?? false;
        return (
          <SettingRow
            key={tool.id}
            label={tool.label}
            description={handoffToolFeatures(tool)
              .map((feature) => handoffToolFeatureLabels[feature])
              .join(" · ")}
          >
            <Switch
              checked={on}
              disabled={!enabled || saving !== undefined}
              aria-label={`Use ${tool.label}`}
              onCheckedChange={(value) => void toggle(tool.id, value)}
            />
          </SettingRow>
        );
      })}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
