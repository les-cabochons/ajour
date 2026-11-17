import {
  handoffToolFeatureLabels,
  handoffToolFeatures,
} from "@ajour/shared/handoffs";
import { SettingRow } from "@/components/app-surface";

interface Tool {
  id: string;
  label: string;
  followsState?: boolean;
  listsThreads?: boolean;
  hooks?: boolean;
}

/**
 * The plugin's handoff tools on its page, each with the features it
 * supports (`handoffToolFeatures`): what Ajour does with its threads.
 */
export function PluginHandoffTools({ tools }: { tools: readonly Tool[] }) {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Handoff tools</h2>
      <p className="settings-section-desc">
        What each tool can do. Ajour uses only what a tool supports.
      </p>
      {tools.map((tool) => (
        <SettingRow
          key={tool.id}
          label={tool.label}
          description={handoffToolFeatures(tool)
            .map((feature) => handoffToolFeatureLabels[feature])
            .join(" · ")}
        />
      ))}
    </section>
  );
}
