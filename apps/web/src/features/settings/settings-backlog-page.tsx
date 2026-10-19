import { SettleRulesSection } from "@/features/settings/settle-rules-section";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CloseParentSubitems } from "@/domain/local-state";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

/**
 * Settings > Backlog: how closing and settling treat a parent's subitems, and
 * whether description links ask before they open.
 */
export function SettingsBacklogPage() {
  const state = useLocalState();

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Subitems</h2>
        <p className="settings-section-desc">
          What happens to a parent's open subitems when you move it to a done
          state or settle it.
        </p>

        <AppPanel>
          <SettingRow
            label="When closing a parent with open subitems"
            description="Subitems already settled or archived stay as they are."
          >
            <ToggleGroup
              aria-label="When closing a parent with open subitems"
              variant="outline"

              value={[state.userPreferences.closeParentSubitems]}
              onValueChange={(next) => {
                const choice = next[0] as CloseParentSubitems | undefined;
                if (choice) {
                  localStore.setUserPreferences({
                    closeParentSubitems: choice,
                  });
                }
              }}
            >
              <ToggleGroupItem value="ask">Ask</ToggleGroupItem>
              <ToggleGroupItem value="include">Include them</ToggleGroupItem>
              <ToggleGroupItem value="leave">Leave them</ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
        </AppPanel>
      </section>
      <SettleRulesSection
        workItems={state.workItems}
        settleRules={state.settleRules ?? []}
      />
      <section className="settings-section">
        <h2 className="settings-section-title">Descriptions</h2>
        <p className="settings-section-desc">
          How Ajour treats links in a description and its frontmatter.
        </p>

        <AppPanel>
          <SettingRow
            label="Ask before opening description links"
            labelFor="ask-before-description-links"
            description="Show a link's full address before it opens in your browser. Descriptions often come from other people in the source tool."
          >
            <Switch
              id="ask-before-description-links"
              checked={
                state.userPreferences.askBeforeOpeningDescriptionLinks !== false
              }
              onCheckedChange={(checked) =>
                localStore.setUserPreferences({
                  askBeforeOpeningDescriptionLinks: checked,
                })
              }
            />
          </SettingRow>
        </AppPanel>
      </section>
    </div>
  );
}
