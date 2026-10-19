import { useEffect, useRef, type CSSProperties } from "react";
import type { BacklogPerson } from "@ajour/shared";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder as placeholderText,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  closeMentionPicker,
  mentionPicker,
} from "@/components/markdown-editor-mentions";

export interface MarkdownEditorProps {
  /** The text of a controlled editor. Pass it with `onChange`. */
  value?: string;
  /** The starting text of an uncontrolled editor. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Called with the text when the editor loses focus. */
  onBlur?: (value: string) => void;
  /** ⌘/Ctrl+Enter. Without it the keys reach the surrounding form. */
  onSubmit?: (value: string) => void;
  /** Escape. Without it the key reaches the surrounding form. */
  onCancel?: () => void;
  "aria-label": string;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** The height the editor keeps while it holds fewer lines. */
  minLines?: number;
  /** Suggests people after `@`, and inserts `[@Name](mention:<id>)`. */
  mentions?: { search: (query: string) => Promise<BacklogPerson[]> };
}

/** A mention reads as one chip and moves as one character. */
class MentionWidget extends WidgetType {
  constructor(readonly name: string) {
    super();
  }

  eq(other: MentionWidget) {
    return other.name === this.name;
  }

  toDOM() {
    const chip = document.createElement("span");
    chip.className = "cm-mention";
    chip.textContent = `@${this.name}`;
    return chip;
  }
}

const mentionMatcher = new MatchDecorator({
  regexp: /\[@([^\]\n]+)\]\(mention:[^)\s]+\)/g,
  decoration: (match) =>
    Decoration.replace({ widget: new MentionWidget(match[1] ?? "") }),
});

const mentionChips = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = mentionMatcher.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = mentionMatcher.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
  },
);

// GFM in its plain language form: the `markdown()` helper would also load
// HTML, CSS and JavaScript highlighting for code blocks.
const markdownSupport = new LanguageSupport(markdownLanguage);

// The text stays Markdown; markers are dimmed and the marked-up text is styled,
// so editing never rewrites what the user did not touch.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.15em", fontWeight: "600" },
  {
    tag: [tags.heading2, tags.heading3, tags.heading4, tags.heading5],
    fontWeight: "600",
  },
  { tag: tags.heading6, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.processingInstruction, color: "var(--text-tertiary)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.92em" },
  { tag: [tags.link, tags.url], color: "var(--primary)" },
  { tag: tags.quote, color: "var(--muted-foreground)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    color: "var(--foreground)",
    backgroundColor: "transparent",
    fontSize: "var(--text-sm)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-sans)", lineHeight: "1.55" },
  ".cm-content": {
    padding: "0",
    minHeight: "calc(var(--markdown-editor-lines, 3) * 1.55em)",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-mention": {
    padding: "0 0.125rem",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--indigo-muted)",
    color: "var(--primary)",
    fontWeight: "500",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "color-mix(in srgb, var(--primary) 22%, transparent)" },
});

/**
 * CodeMirror with Markdown styling. Loaded through `MarkdownEditor` only, so
 * the editor's code downloads when an editor first opens.
 */
export default function MarkdownEditorView({
  value,
  defaultValue,
  onChange,
  onBlur,
  onSubmit,
  onCancel,
  "aria-label": ariaLabel,
  id,
  placeholder,
  autoFocus,
  minLines = 3,
  mentions,
}: MarkdownEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The view is built once; its handlers read the latest props through this.
  const handlers = useRef({ onChange, onBlur, onSubmit, onCancel, mentions });
  handlers.current = { onChange, onBlur, onSubmit, onCancel, mentions };

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value ?? defaultValue ?? "",
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: (target) => {
                  const submit = handlers.current.onSubmit;
                  if (!submit) return false;
                  submit(target.state.doc.toString());
                  return true;
                },
              },
              {
                key: "Escape",
                run: (target) => {
                  if (closeMentionPicker(target)) return true;
                  const cancel = handlers.current.onCancel;
                  if (!cancel) return false;
                  cancel();
                  return true;
                },
              },
            ]),
          ),
          history(),
          mentionChips,
          ...(mentions
            ? [
                mentionPicker(
                  () => handlers.current.mentions?.search ?? (async () => []),
                ),
              ]
            : []),
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          markdownSupport,
          syntaxHighlighting(markdownHighlight),
          editorTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            "aria-multiline": "true",
            ...(id ? { id } : {}),
          }),
          ...(placeholder ? [placeholderText(placeholder)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlers.current.onChange?.(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            blur: (_event, target) => {
              // Removing a focused editor blurs it; that is not the user leaving.
              if (viewRef.current !== target) return false;
              handlers.current.onBlur?.(target.state.doc.toString());
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    }
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // The view is created once per mount; later props reach it below.
  }, []);

  // A controlled value that changed outside the editor replaces its text.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === undefined) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={parentRef}
      style={{ "--markdown-editor-lines": minLines } as CSSProperties}
    />
  );
}
