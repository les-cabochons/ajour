import { useEffect, useRef, type CSSProperties } from "react";
import type { BacklogPerson } from "@ajour/shared";
import {
  autocompletion,
  closeCompletion,
  completionKeymap,
  completionStatus,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  EditorState,
  MapMode,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder as placeholderText,
  showTooltip,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

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

const escapeName = (name: string) => name.replace(/[[\]\\]/g, "");

/**
 * The `@name` being typed, which the mention suggestions answer: up to three
 * words with one space between them, so a last name can follow the first.
 * Two spaces or a fourth word end it.
 */
const mentionWord = /@(?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,2} ?)?$/;

interface MentionStatus {
  /** Where the `@` is. */
  from: number;
  /** The `@name` it answers. */
  word: string;
  text: string;
}

const setMentionStatus = StateEffect.define<MentionStatus | null>();

/**
 * A line in place of the suggestions when there are none to pick: asking
 * for a name after a bare `@`, or saying no one was found. It goes when the
 * text changes, the cursor leaves the `@name` it answers or the editor loses
 * focus.
 */
const mentionStatus = StateField.define<MentionStatus | null>({
  create: () => null,
  update(status, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMentionStatus)) return effect.value;
    }
    // Typing asks again, and the answer brings the next line.
    if (!status || transaction.docChanged) return null;
    if (!transaction.selection) return status;
    const head = transaction.state.selection.main.head;
    const typed = transaction.state.sliceDoc(status.from, head);
    return head > status.from && status.word.startsWith(typed) ? status : null;
  },
  provide: (field) => [
    showTooltip.from(field, (status) =>
      status
        ? {
            pos: status.from,
            create: () => {
              const dom = document.createElement("div");
              dom.className = "cm-mention-status";
              dom.setAttribute("role", "status");
              dom.textContent = status.text;
              return { dom };
            },
          }
        : null,
    ),
    EditorView.focusChangeEffect.of((_state, focusing) =>
      focusing ? null : setMentionStatus.of(null),
    ),
  ],
});

const setDismissedMention = StateEffect.define<number | null>();

/**
 * Where the `@` is whose suggestions Escape closed: typing on in that name
 * asks no more, until Ctrl+Space asks again. It goes with the `@`.
 */
const dismissedMention = StateField.define<number | null>({
  create: () => null,
  update(from, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDismissedMention)) return effect.value;
    }
    return from === null
      ? null
      : transaction.changes.mapPos(from, 1, MapMode.TrackDel);
  },
});

/**
 * Escape closes the suggestions or their status line first, so it leaves
 * the editor only when nothing about a mention is showing.
 */
function closeMentions(view: EditorView) {
  const { state } = view;
  const status = state.field(mentionStatus, false);
  if (!status && completionStatus(state) === null) return false;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const word = mentionWord.exec(state.sliceDoc(line.from, head));
  closeCompletion(view);
  view.dispatch({
    effects: [
      setMentionStatus.of(null),
      setDismissedMention.of(
        status?.from ?? (word ? line.from + word.index : null),
      ),
    ],
  });
  return true;
}

/** Suggestions for the name after `@`, even inside a word, as in an email. */
function mentionSource(
  search: () => (query: string) => Promise<BacklogPerson[]>,
) {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const word = context.matchBefore(mentionWord);
    if (!word) return null;
    if (context.state.field(dismissedMention, false) === word.from) {
      if (!context.explicit) return null;
      // Ctrl+Space asks again, and typing on keeps asking.
      await Promise.resolve();
      context.view?.dispatch({ effects: setDismissedMention.of(null) });
    }
    // CodeMirror keeps a query running while the text changes, so an answer
    // counts only while this `@word` is still what is typed, in focus.
    const stillTyped = () => {
      const view = context.view;
      if (!view) return true;
      const { state } = view;
      return (
        !context.aborted &&
        view.hasFocus &&
        state.sliceDoc(word.from, state.selection.main.head) === word.text
      );
    };
    // An empty answer, not null: CodeMirror reads null as a failure and
    // stops, while an answer that the newer text outdates makes it ask again.
    const outdated: CompletionResult = { from: word.from, options: [] };
    const showStatus = (text: string | null) => {
      const view = context.view;
      if (!view) return;
      if (text === null && !view.state.field(mentionStatus, false)) return;
      view.dispatch({
        effects: setMentionStatus.of(
          text ? { from: word.from, word: word.text, text } : null,
        ),
      });
    };
    const query = word.text.slice(1).trim();
    if (!query) {
      // Out of the completion's own update.
      await Promise.resolve();
      if (!stillTyped()) return outdated;
      showStatus("Type a name to mention someone");
      return null;
    }
    // Typing fast asks once, for the last query.
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!stillTyped()) return outdated;
    // A search that fails reads like one that found no one.
    const people = await search()(query).catch(() => []);
    if (!stillTyped()) return outdated;
    if (people.length === 0) {
      // After a space, no one found likely means the user writes on, so the
      // suggestions just close.
      if (!/\s/.test(word.text)) showStatus("No one found");
      return null;
    }
    // A retry that finds people replaces an earlier "No one found".
    showStatus(null);
    return {
      from: word.from,
      filter: false,
      options: people.map((person) => ({
        label: person.displayName || person.id,
        apply: `[@${escapeName(person.displayName || person.id)}](mention:${person.id}) `,
        type: "mention",
      })),
    };
  };
}

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
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    backgroundColor: "var(--popover)",
    boxShadow: "var(--shadow-popup)",
    padding: "0.25rem",
  },
  ".cm-tooltip.cm-mention-status": {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    backgroundColor: "var(--popover)",
    boxShadow: "var(--shadow-popup)",
    padding: "0.375rem 0.75rem",
    color: "var(--muted-foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "0.25rem 0.5rem",
    borderRadius: "var(--radius-sm)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--hover-bg)",
    color: "var(--foreground)",
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
                  if (closeMentions(target)) return true;
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
                autocompletion({
                  override: [
                    mentionSource(
                      () =>
                        handlers.current.mentions?.search ?? (async () => []),
                    ),
                  ],
                  icons: false,
                }),
                mentionStatus,
                dismissedMention,
                keymap.of(completionKeymap),
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
