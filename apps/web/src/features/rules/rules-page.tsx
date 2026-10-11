import { useState } from "react";
import type { ActivityBlockRecord, RuleRecord } from "@timetracker/shared";
import { MessagePanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import {
  useLocalProjects,
  useLocalRules,
  useLocalState,
} from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

export function RulesPage() {
  const state = useLocalState();
  const rules = useLocalRules();
  const projects = useLocalProjects();
  const [draft, setDraft] = useState({
    targetProjectId: "",
    domain: "",
    pathnamePrefix: "",
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <CardHeader>
          <CardTitle>Local rules</CardTitle>
          <p className="mt-2 text-sm text-foreground/65">
            Rules are deliberate. Saving one makes future local suggestions
            better, but the rule itself contains URL/app matching data.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <MessagePanel tone="warning">
            Privacy warning: rules are less private than drafts because they
            store reusable domain and path matchers. Do not save YouTube,
            banking, personal email, or other sensitive patterns.
          </MessagePanel>

          <div className="grid gap-3 rounded-lg border border-[var(--border)] p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Project</Label>
                <NativeSelect
                  value={draft.targetProjectId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      targetProjectId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project._id} value={project._id}>
                      {project.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label>Domain</Label>
                <Input
                  value={draft.domain}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      domain: event.target.value,
                    }))
                  }
                  placeholder="github.com"
                />
              </div>
            </div>
            <Input
              value={draft.pathnamePrefix}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  pathnamePrefix: event.target.value,
                }))
              }
              placeholder="/myorg/payments"
            />
            <Button
              onClick={() => {
                const blockLike: ActivityBlockRecord = {
                  userId: state.user._id,
                  teamId: state.team?._id ?? "local_team",
                  localDate: new Date().toISOString().slice(0, 10),
                  startedAt: Date.now(),
                  endedAt: Date.now(),
                  durationMs: 0,
                  sourceSegmentIds: [],
                  fingerprint: draft.domain,
                  display: {
                    label: draft.domain,
                    subtitle: draft.pathnamePrefix,
                  },
                  status: "edited",
                  projectId: draft.targetProjectId,
                  assignmentSource: "manual",
                  confidence: 1,
                  isMicroBlock: false,
                  locked: true,
                  domain: draft.domain,
                  pathname: draft.pathnamePrefix || "/",
                  title: "",
                };
                localStore.saveRuleFromBlock(blockLike);
              }}
              disabled={!draft.targetProjectId || !draft.domain}
            >
              Save manual local rule
            </Button>
          </div>

          {rules.map((rule: RuleRecord) => (
            <div
              key={rule.id}
              className="rounded-md border border-[var(--border)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">
                    {rule.condition.domain ?? "Any domain"}
                  </p>
                  <p className="text-sm text-foreground/60">
                    {rule.condition.pathnamePrefix ?? "Any path"} · suggests{" "}
                    {projects.find(
                      (project) => project._id === rule.targetProjectId,
                    )?.name ?? "Unknown project"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Learning behavior</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-foreground/70">
          <p>
            For this local-only cut, learning happens through rules you
            explicitly save from reviewed blocks.
          </p>
          <p>
            Next step: keep local correction history and generate local-only
            rule proposals before offering to sync accepted rules.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
