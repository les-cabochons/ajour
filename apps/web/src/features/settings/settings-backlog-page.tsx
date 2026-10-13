import { SettleRulesSection } from "@/features/settings/settle-rules-section";
import { AppPanel } from "@/components/app-surface";
import { Field, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CloseParentSubitems } from "@/domain/local-state";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

/** Settings > Backlog: how closing and settling treat a parent's subitems. */
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
          <Field
            orientation="horizontal"
            className="rounded-2xl border border-border/70 p-4"
          >
            <div className="flex-1">
              <FieldLabel>When closing a parent with open subitems</FieldLabel>
              <p className="mt-1 text-sm text-muted-foreground">
                Subitems already settled or archived stay as they are.
              </p>
            </div>
            <ToggleGroup
              aria-label="When closing a parent with open subitems"
              variant="outline"
              size="sm"
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
          </Field>
        </AppPanel>
      </section>
      <SettleRulesSection
        workItems={state.workItems}
        settleRules={state.settleRules ?? []}
      />
    </div>
  );
}
