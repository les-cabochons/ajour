import { useEffect, useMemo, useRef, useState } from "react";
import {
  HANDOFF_SLOTS,
  fillHandoffTemplates,
  handoffTemplatesSchema,
  type HandoffTemplates,
  type HandoffTemplateContext,
} from "@ajour/shared/handoff-templates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useLocalState } from "@/lib/local-hooks";
import {
  getHandoffTemplates,
  saveHandoffTemplates,
  listRepositoryFolders,
} from "@/lib/app-api";
interface PreviewItem {
  id: string;
  label: string;
  context: HandoffTemplateContext;
}
export function HandoffTemplateEditor({
  initial,
  items,
  onSave,
}: {
  initial: HandoffTemplates;
  items: PreviewItem[];
  onSave: (templates: HandoffTemplates) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(initial);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const active = useRef<keyof HandoffTemplates>("prompt");
  const fields = useRef<
    Partial<Record<keyof HandoffTemplates, HTMLTextAreaElement>>
  >({});
  const parsed = handoffTemplatesSchema.safeParse(draft);
  const item = items.find((item) => item.id === selected);
  const preview =
    parsed.success && item
      ? fillHandoffTemplates(parsed.data, item.context)
      : undefined;
  const labels = { prompt: "Prompt", title: "Title", branch: "Branch" };
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Handoff templates</h2>
      <p className="settings-section-desc">
        Saved on this computer for this plugin. Choose a field, then insert a
        slot. Add |slug inside a slot for a branch segment.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!parsed.success) return;
          setSaving(true);
          setError("");
          setSaved(false);
          try {
            await onSave(parsed.data);
            setSaved(true);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not save templates.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {(["prompt", "title", "branch"] as const).map((key) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            {labels[key]} template
            <Textarea
              disabled={saving}
              aria-label={`${labels[key]} template`}
              ref={(node) => {
                if (node) fields.current[key] = node;
              }}
              rows={key === "prompt" ? 7 : 2}
              className="font-mono"
              value={draft[key]}
              onFocus={() => {
                active.current = key;
              }}
              onChange={(event) => {
                setDraft({ ...draft, [key]: event.target.value });
                setSaved(false);
              }}
            />
          </label>
        ))}
        <div className="flex flex-wrap gap-1" aria-label="Template slots">
          {HANDOFF_SLOTS.map((slot) => (
            <Button
              key={slot}
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              aria-label={`Insert ${slot}`}
              onClick={() => {
                const key = active.current;
                const field = fields.current[key];
                const start = field?.selectionStart ?? draft[key].length;
                const end = field?.selectionEnd ?? start;
                const text = `{{${slot}}}`;
                setDraft({
                  ...draft,
                  [key]:
                    draft[key].slice(0, start) + text + draft[key].slice(end),
                });
                setSaved(false);
                requestAnimationFrame(() => {
                  field?.focus();
                  field?.setSelectionRange(
                    start + text.length,
                    start + text.length,
                  );
                });
              }}
            >{`{{${slot}}}`}</Button>
          ))}
        </div>
        {!parsed.success ? (
          <p role="alert" className="text-destructive">
            {parsed.error.issues[0]?.message}
          </p>
        ) : null}
        <Button
          className="self-start"
          disabled={saving || !parsed.success}
          type="submit"
        >
          Save templates
        </Button>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {saved ? <p role="status">Templates saved.</p> : null}
      </form>
      <label className="mt-4 block text-sm">
        Preview item
        <Input
          aria-label="Find preview item"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="max-h-40 overflow-auto">
        {items
          .filter((item) =>
            item.label.toLowerCase().includes(search.toLowerCase()),
          )
          .map((item) => (
            <Button
              variant="ghost"
              key={item.id}
              aria-pressed={selected === item.id}
              aria-label={`Preview ${item.label}`}
              onClick={() => setSelected(item.id)}
            >
              {item.label}
            </Button>
          ))}
      </div>
      {!items.length ? (
        <p className="text-muted-foreground">
          Add a backlog item to preview these templates.
        </p>
      ) : null}
      {preview ? (
        <div className="mt-4 flex flex-col gap-3">
          {(["prompt", "title", "branch"] as const).map((key) => (
            <div key={key}>
              <h3 className="text-sm">{labels[key]} preview</h3>
              <pre
                aria-label={`${labels[key]} preview`}
                className="text-sm break-words whitespace-pre-wrap"
              >
                {preview[key]}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
export function PluginHandoffTemplates({ pluginId }: { pluginId: string }) {
  const state = useLocalState();
  const [initial, setInitial] = useState<HandoffTemplates>();
  const [folders, setFolders] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setInitial(undefined);
    setError("");
    void getHandoffTemplates(pluginId)
      .then((value) => {
        if (live) setInitial(value);
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    return () => {
      live = false;
    };
  }, [pluginId]);
  useEffect(() => {
    let live = true;
    void Promise.all(
      state.projects.map(
        async (project) =>
          [
            project._id,
            (await listRepositoryFolders(project._id)).sort(
              (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
            )[0]?.name ?? "",
          ] as const,
      ),
    )
      .then((entries) => {
        if (live) setFolders(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [state.projects]);
  const items = useMemo(() => {
    const parents = new Map(state.workItems.map((item) => [item._id, item]));
    const projects = new Map(
      state.projects.map((project) => [project._id, project]),
    );
    return state.workItems.map((item) => {
      const parent = parents.get(item.parentWorkItemId ?? "");
      return {
        id: item._id,
        label: `${item.sourceExternalId ?? ""} ${item.title}`.trim(),
        context: {
          item: {
            key: item.sourceExternalId ?? "",
            title: item.title,
            description: item.description,
            url: item.sourceUrl ?? "",
            type: item.sourceWorkItemType ?? "",
            parent: parent
              ? { key: parent.sourceExternalId ?? "", title: parent.title }
              : undefined,
          },
          projectName: projects.get(item.projectId ?? "")?.name ?? "",
          repoName: folders[item.projectId ?? ""] ?? "",
        },
      };
    });
  }, [state.workItems, state.projects, folders]);
  if (error) return <p role="alert">{error}</p>;
  return initial ? (
    <HandoffTemplateEditor
      key={pluginId}
      initial={initial}
      items={items}
      onSave={(value) => saveHandoffTemplates(pluginId, value)}
    />
  ) : (
    <p role="status">Loading handoff templates...</p>
  );
}
