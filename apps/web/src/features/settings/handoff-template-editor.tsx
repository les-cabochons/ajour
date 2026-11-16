import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getWorkItemLookupKeys,
  getWorkItemParentKey,
} from "@/domain/backlog/work-item-hierarchy";
import {
  HANDOFF_SLOTS,
  isValidHandoffBranch,
  handoffTitle,
  fillHandoffTemplates,
  handoffTemplatesSchema,
  type HandoffTemplates,
  type HandoffTemplateContext,
} from "@ajour/shared/handoff-templates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
const PreviewItemPicker = memo(function PreviewItemPicker({
  items,
  selected,
  onChange,
}: {
  items: PreviewItem[];
  selected: string;
  onChange: (id: string) => void;
}) {
  const options = useMemo(
    () => items.map((item) => ({ value: item.id, label: item.label })),
    [items],
  );
  return (
    <SearchableSelect
      ariaLabel="Preview item"
      value={selected}
      options={options}
      onChange={onChange}
      placeholder="Choose a preview item…"
      emptyMessage="No matching items."
    />
  );
});
export function HandoffTemplateEditor({
  initial,
  items,
  onSave,
  onPreviewItemChange,
  repoName,
}: {
  initial: HandoffTemplates;
  items: PreviewItem[];
  onPreviewItemChange?: (id: string) => void;
  repoName?: string;
  onSave: (templates: HandoffTemplates) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(initial);
  const [selected, setSelected] = useState("");
  const selectItem = useCallback(
    (id: string) => {
      setSelected(id);
      onPreviewItemChange?.(id);
    },
    [onPreviewItemChange],
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const active = useRef<keyof HandoffTemplates>("prompt");
  const fields = useRef<
    Partial<
      Record<keyof HandoffTemplates, HTMLTextAreaElement | HTMLInputElement>
    >
  >({});
  const parsed = handoffTemplatesSchema.safeParse(draft);
  const item = items.find((item) => item.id === selected);
  const preview =
    parsed.success && item
      ? fillHandoffTemplates(parsed.data, {
          ...item.context,
          repoName: repoName ?? item.context.repoName,
        })
      : undefined;
  const invalidBranch =
    preview?.branch &&
    (preview.branch.length > 500 || !isValidHandoffBranch(preview.branch));
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
        {(["prompt", "title", "branch"] as const).map((key) => {
          const Field = key === "prompt" ? Textarea : Input;
          return (
            <label key={key} className="flex flex-col gap-1 text-sm">
              {labels[key]} template
              <Field
                disabled={saving}
                aria-label={`${labels[key]} template`}
                ref={(node: HTMLTextAreaElement | HTMLInputElement | null) => {
                  if (node) fields.current[key] = node;
                }}
                {...(key === "prompt" ? { rows: 7 } : {})}
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
          );
        })}
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
      <div className="mt-4">
        <p className="text-sm">Preview item</p>
        <PreviewItemPicker
          items={items}
          selected={selected}
          onChange={selectItem}
        />
      </div>
      {invalidBranch ? (
        <p role="alert" className="text-destructive">
          The branch template produces an invalid git branch. Leave it empty for
          no worktree.
        </p>
      ) : null}
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
                {key === "title" ? handoffTitle(preview.title) : preview[key]}
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
  const [selected, setSelected] = useState("");
  const projectId = state.workItems.find(
    (item) => item._id === selected,
  )?.projectId;
  const [folder, setFolder] = useState<{ projectId: string; name: string }>();
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
    if (projectId)
      void listRepositoryFolders(projectId)
        .then((folders) => {
          const name =
            folders.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0]
              ?.name ?? "";
          if (live) setFolder({ projectId, name });
        })
        .catch(() => {
          if (live) setFolder({ projectId, name: "" });
        });
    return () => {
      live = false;
    };
  }, [projectId]);
  const items = useMemo(() => {
    // A synced subitem names its parent by source id, a local one by its id.
    const parents = new Map(
      state.workItems.flatMap((item) =>
        getWorkItemLookupKeys(item).map((key) => [key, item] as const),
      ),
    );
    const projects = new Map(
      state.projects.map((project) => [project._id, project]),
    );
    return state.workItems.map((item) => {
      const parentKey = getWorkItemParentKey(item);
      const parent = parentKey ? parents.get(parentKey) : undefined;
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
          repoName: "",
        },
      };
    });
  }, [state.workItems, state.projects]);
  if (error) return <p role="alert">{error}</p>;
  return initial ? (
    <HandoffTemplateEditor
      key={pluginId}
      initial={initial}
      items={items}
      onPreviewItemChange={setSelected}
      repoName={folder?.projectId === projectId ? folder?.name : ""}
      onSave={(value) => saveHandoffTemplates(pluginId, value)}
    />
  ) : null;
}
