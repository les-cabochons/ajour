import type { BacklogPerson } from "@ajour/shared";
import {
  EditorState,
  MapMode,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  keymap,
  showTooltip,
  type Tooltip,
  type TooltipView,
  type ViewUpdate,
} from "@codemirror/view";
import { personInitials } from "@/domain/backlog/comments";

export type PeopleSearch = (query: string) => Promise<BacklogPerson[]>;

/**
 * The `@name` before the cursor, even inside a word, as in an email: up to
 * three words with one space between them, so a last name can follow the
 * first. Two spaces or a fourth word end it.
 */
const mentionWord = /@(?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,2} ?)?$/;

/** How long typing pauses before a name is searched. A bare @ asks at once. */
const SEARCH_PAUSE_MS = 150;

interface MentionAtCursor {
  /** Where the `@` is. */
  from: number;
  /** The `@name` up to the cursor. */
  word: string;
  /** The name, as the search gets it. */
  query: string;
}

function mentionAtCursor(state: EditorState): MentionAtCursor | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const line = state.doc.lineAt(main.head);
  const start = Math.max(line.from, main.head - 250);
  const match = mentionWord.exec(state.sliceDoc(start, main.head));
  if (!match) return null;
  return {
    from: start + match.index,
    word: match[0],
    query: match[0].slice(1).trim().replace(/\s+/g, " "),
  };
}

interface Picker extends MentionAtCursor {
  /** Each opening, so an answer knows which picker asked. */
  id: number;
  /** Where the cursor was when the name was last asked for. */
  head: number;
  /** The last answer, kept in view while the next search runs. */
  people: BacklogPerson[];
  /** The query `people` answers; null before the first answer. */
  answered: string | null;
  selected: number;
  tooltip: Tooltip;
}

interface Mentions {
  picker: Picker | null;
  /**
   * Where the `@` is whose picker Escape closed: it opens no more until
   * Ctrl+Space, and the dismissal goes with that `@`.
   */
  dismissed: number | null;
  nextId: number;
}

const answerSearch = StateEffect.define<{
  id: number;
  query: string;
  people: BacklogPerson[];
}>();
const selectPerson = StateEffect.define<number>();
/** Escape: the picker closes, and its `@` stays closed. */
const dismissPicker = StateEffect.define<null>();
/** Focus left: the picker closes until the user types again. */
const closePicker = StateEffect.define<null>();
/**
 * Ctrl+Space, or Alt+` or Alt+I on a Mac: the picker opens for the `@name`
 * at the cursor and searches again.
 */
const reopenPicker = StateEffect.define<null>();

/** A name's characters, as the mention pattern reads them. */
const nameChars = /^[^\s@[\]()]*/;
const nameCharsBefore = /[^\s@[\]()]*$/;

/** Whether `head` is in the word the picker's name was asked from. */
function withinWord(state: EditorState, picker: Picker, head: number) {
  if (/\s$/.test(picker.word)) return false;
  const line = state.doc.lineAt(picker.head);
  const start =
    picker.head -
    nameCharsBefore.exec(state.sliceDoc(line.from, picker.head))![0].length;
  const end =
    picker.head +
    nameChars.exec(state.sliceDoc(picker.head, line.to))![0].length;
  return head >= start && head <= end;
}

const comparable = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Where picking a person ends the replaced name. Past the cursor it takes
 * the text a word at a time, the word the cursor sits in or against first,
 * and only while the text from the `@` still reads as the start of the
 * person's name: `@A|na Silva` and `@Ana |Silva` become Ana Silva's mention,
 * while `@Ana|please` and `@Ana please` keep "please".
 */
function nameEnd(state: EditorState, from: number, person: BacklogPerson) {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const name = comparable(person.displayName || person.id);
  let end = head;
  for (const [index, word] of [/^[^\s@[\]()]+/, /^ [^\s@[\]()]+/].entries()) {
    for (;;) {
      const next = word.exec(state.sliceDoc(end, line.to));
      if (!next) break;
      const reads = comparable(state.sliceDoc(from + 1, end + next[0].length));
      if (!name.startsWith(reads)) return end;
      end += next[0].length;
      // The word the cursor sits in or against comes once.
      if (index === 0) break;
    }
  }
  return end;
}

function searching(picker: Picker) {
  return picker.answered !== picker.query;
}

/**
 * After a space, the user is likely writing on, so a name that has no one to
 * show shows nothing, not "Searching…" or "No one found". Its searches go on
 * and the picker comes back when one finds someone.
 */
function shown(picker: Picker | null): picker is Picker {
  return (
    picker !== null && (picker.people.length > 0 || !/\s/.test(picker.word))
  );
}

const mentions = StateField.define<Mentions>({
  create: () => ({ picker: null, dismissed: null, nextId: 1 }),
  update(value, transaction) {
    let { picker, dismissed, nextId } = value;
    if (transaction.docChanged && dismissed !== null) {
      dismissed = transaction.changes.mapPos(dismissed, 1, MapMode.TrackAfter);
    }
    if (transaction.docChanged && picker) {
      const from = transaction.changes.mapPos(picker.from, 1);
      picker = {
        ...picker,
        from,
        head: transaction.changes.mapPos(picker.head, 1),
        // The picker follows its `@`, as when its line moves.
        ...(from === picker.from
          ? {}
          : { tooltip: { ...picker.tooltip, pos: from } }),
      };
    }
    let reopen = false;
    for (const effect of transaction.effects) {
      if (effect.is(dismissPicker)) {
        const from =
          picker?.from ?? mentionAtCursor(transaction.state)?.from ?? null;
        return { picker: null, dismissed: from, nextId };
      }
      if (effect.is(closePicker)) return { picker: null, dismissed, nextId };
      if (effect.is(reopenPicker)) {
        reopen = true;
        dismissed = null;
      }
      if (effect.is(selectPerson) && picker) {
        picker = { ...picker, selected: effect.value };
      }
      if (
        effect.is(answerSearch) &&
        picker &&
        effect.value.id === picker.id &&
        effect.value.query === picker.query
      ) {
        // The highlight stays on the same person when the answer keeps them.
        const highlighted = picker.people[picker.selected]?.id;
        const people = effect.value.people;
        picker = {
          ...picker,
          people,
          answered: effect.value.query,
          selected: Math.max(
            0,
            people.findIndex((person) => person.id === highlighted),
          ),
        };
      }
    }
    if (!transaction.docChanged && !transaction.selection && !reopen) {
      return picker === value.picker ? value : { picker, dismissed, nextId };
    }

    const at = mentionAtCursor(transaction.state);
    if (!at || at.from === dismissed)
      return { picker: null, dismissed, nextId };
    if (picker && picker.from === at.from) {
      if (!transaction.docChanged && !reopen) {
        // Moving the cursor back within the name, or within the word it was
        // asked from, keeps its answer; moving on past them closes it.
        return picker.word.startsWith(at.word) ||
          withinWord(transaction.state, picker, at.from + at.word.length)
          ? { picker, dismissed, nextId }
          : { picker: null, dismissed, nextId };
      }
      return {
        picker: {
          ...picker,
          ...at,
          head: transaction.state.selection.main.head,
          ...(reopen ? { id: nextId, answered: null } : {}),
        },
        dismissed,
        nextId: reopen ? nextId + 1 : nextId,
      };
    }
    // A picker opens as the user types, or on Ctrl+Space.
    if (!reopen && !transaction.isUserEvent("input.type")) {
      return { picker: null, dismissed, nextId };
    }
    return {
      picker: {
        ...at,
        head: transaction.state.selection.main.head,
        id: nextId,
        people: [],
        answered: null,
        selected: 0,
        tooltip: {
          pos: at.from,
          create: (view) => new PickerView(view),
        },
      },
      dismissed,
      nextId: nextId + 1,
    };
  },
  provide: (field) => [
    showTooltip.compute([field], (state) => {
      const { picker } = state.field(field);
      return shown(picker) ? picker.tooltip : null;
    }),
    EditorView.focusChangeEffect.of((_state, focusing) =>
      focusing ? null : closePicker.of(null),
    ),
  ],
});

/** The picker the user sees, if any. */
function visiblePicker(state: EditorState) {
  const picker = state.field(mentions, false)?.picker ?? null;
  return shown(picker) ? picker : null;
}

/**
 * Escape closes the picker first, so it leaves the editor only when no
 * picker shows. The `@` then stays closed until Ctrl+Space.
 */
export function closeMentionPicker(view: EditorView) {
  const value = view.state.field(mentions, false);
  if (!value?.picker) return false;
  if (!shown(value.picker)) {
    view.dispatch({ effects: closePicker.of(null) });
    return false;
  }
  view.dispatch({ effects: dismissPicker.of(null) });
  return true;
}

const escapeName = (name: string) => name.replace(/[[\]\\]/g, "");

function pickPerson(view: EditorView, index: number) {
  const picker = visiblePicker(view.state);
  const person = picker?.people[index];
  if (!picker || !person) return false;
  const insert = `[@${escapeName(person.displayName || person.id)}](mention:${person.id}) `;
  view.dispatch({
    changes: {
      from: picker.from,
      to: nameEnd(view.state, picker.from, person),
      insert,
    },
    selection: { anchor: picker.from + insert.length },
    userEvent: "input.complete",
  });
  return true;
}

function movePicker(view: EditorView, step: number) {
  const picker = visiblePicker(view.state);
  if (!picker || picker.people.length === 0) return false;
  const count = picker.people.length;
  view.dispatch({
    effects: selectPerson.of((picker.selected + step + count) % count),
  });
  return true;
}

/** Enter and Tab pick only from an answer to what is typed. */
function pickSelected(view: EditorView) {
  const picker = visiblePicker(view.state);
  if (!picker) return false;
  // While the answer is out of date, the keys wait for the next one.
  if (searching(picker)) return true;
  return pickPerson(view, picker.selected);
}

function reopen(view: EditorView) {
  if (!mentionAtCursor(view.state)) return false;
  view.dispatch({ effects: reopenPicker.of(null) });
  return true;
}

const pickerKeymap = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: (view) => movePicker(view, 1) },
    { key: "ArrowUp", run: (view) => movePicker(view, -1) },
    { key: "Enter", run: pickSelected },
    { key: "Tab", run: pickSelected },
    { key: "Ctrl-Space", run: reopen },
    { mac: "Alt-`", run: reopen },
    { mac: "Alt-i", run: reopen },
  ]),
);

/** Searches each name the open picker shows, after a pause in the typing. */
function searchPlugin(search: () => PeopleSearch) {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      key: string | null = null;
      /** Each change of what to search, so only the latest search answers. */
      generation = 0;
      destroyed = false;

      constructor(readonly view: EditorView) {
        this.sync();
      }

      update() {
        this.sync();
      }

      sync() {
        const { picker } = this.view.state.field(mentions);
        const key =
          picker && searching(picker) ? `${picker.id}\n${picker.query}` : null;
        if (key === this.key) return;
        this.key = key;
        this.generation += 1;
        clearTimeout(this.timer);
        if (!picker || key === null) return;
        const { id, query } = picker;
        const generation = this.generation;
        this.timer = setTimeout(
          () => {
            // A search that fails reads like one that found no one. An
            // answer counts only while nothing newer was asked, even when
            // the text came back to the same name.
            void search()(query)
              .catch(() => [])
              .then((people) => {
                if (this.destroyed || generation !== this.generation) return;
                this.view.dispatch({
                  effects: answerSearch.of({ id, query, people }),
                });
              });
          },
          query ? SEARCH_PAUSE_MS : 0,
        );
      }

      destroy() {
        this.destroyed = true;
        clearTimeout(this.timer);
      }
    },
  );
}

let pickerCount = 0;

/** The listbox of one editor's picker, so the editor can point at it. */
const listboxId = StateField.define<string>({
  create: () => `cm-mention-people-${++pickerCount}`,
  update: (id) => id,
});

const optionId = (state: EditorState, index: number) =>
  `${state.field(listboxId)}-${index}`;

/** The picker's list and its footer, in place of CodeMirror's completion list. */
class PickerView implements TooltipView {
  dom = document.createElement("div");
  list = document.createElement("ul");
  footer = document.createElement("div");
  people: BacklogPerson[] | null = null;

  constructor(readonly view: EditorView) {
    this.dom.className = "cm-mention-picker";
    this.list.className = "cm-mention-list";
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", "People");
    this.list.id = view.state.field(listboxId);
    this.footer.className = "cm-mention-status";
    this.footer.setAttribute("role", "status");
    this.dom.append(this.list, this.footer);
    // Clicking keeps the focus in the editor.
    this.dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const option = (event.target as Element).closest<HTMLElement>(
        "[data-index]",
      );
      if (option) pickPerson(view, Number(option.dataset.index));
    });
    this.render(view.state);
  }

  update(update: ViewUpdate) {
    if (update.startState.field(mentions) !== update.state.field(mentions)) {
      this.render(update.state);
    }
  }

  render(state: EditorState) {
    const picker = visiblePicker(state);
    if (!picker) return;
    if (picker.people !== this.people) {
      this.people = picker.people;
      this.list.replaceChildren(
        ...picker.people.map((person, index) => {
          const option = document.createElement("li");
          option.className = "cm-mention-option";
          option.id = optionId(state, index);
          option.setAttribute("role", "option");
          option.dataset.index = String(index);
          const name = person.displayName || person.id;
          const avatar = document.createElement("span");
          avatar.className = "cm-mention-avatar";
          avatar.setAttribute("aria-hidden", "true");
          avatar.textContent = personInitials(name);
          const text = document.createElement("span");
          text.className = "cm-mention-person";
          const nameLine = document.createElement("span");
          nameLine.className = "cm-mention-name";
          nameLine.textContent = name;
          text.append(nameLine);
          if (person.email) {
            const emailLine = document.createElement("span");
            emailLine.className = "cm-mention-email";
            emailLine.textContent = person.email;
            text.append(emailLine);
          }
          option.append(avatar, text);
          return option;
        }),
      );
      this.list.hidden = picker.people.length === 0;
    }
    const options = this.list.children;
    for (let index = 0; index < options.length; index += 1) {
      options[index]!.setAttribute(
        "aria-selected",
        String(index === picker.selected),
      );
    }
    const count = picker.people.length;
    const busy = searching(picker);
    this.footer.replaceChildren();
    if (busy) {
      const spinner = document.createElement("span");
      spinner.className = "cm-mention-spinner";
      spinner.setAttribute("aria-hidden", "true");
      this.footer.append(spinner, "Searching…");
    } else {
      this.footer.append(
        count > 0
          ? `Showing ${count} suggestion${count === 1 ? "" : "s"}`
          : picker.query
            ? "No one found"
            : "Type a name to mention someone",
      );
    }
    this.footer.classList.toggle("cm-mention-status-alone", count === 0);
    // The highlighted person stays in view as the arrows move it.
    const selected = options[picker.selected] as HTMLElement | undefined;
    if (selected) {
      this.view.requestMeasure({
        read: () => {
          const list = this.list;
          const top = selected.offsetTop;
          const bottom = top + selected.offsetHeight;
          if (top < list.scrollTop) return top;
          if (bottom > list.scrollTop + list.clientHeight) {
            return bottom - list.clientHeight;
          }
          return null;
        },
        write: (scrollTop) => {
          if (scrollTop !== null) this.list.scrollTop = scrollTop;
        },
      });
    }
  }
}

const pickerTheme = EditorView.theme({
  ".cm-tooltip.cm-mention-picker": {
    width: "20rem",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    backgroundColor: "var(--popover)",
    boxShadow: "var(--shadow-popup)",
    padding: "0.25rem",
    fontFamily: "var(--font-sans)",
  },
  ".cm-mention-list": {
    maxHeight: "15.5rem",
    overflowY: "auto",
    margin: "0",
    padding: "0",
    listStyle: "none",
  },
  ".cm-mention-option": {
    display: "flex",
    alignItems: "center",
    gap: "0.625rem",
    minHeight: "2.5rem",
    padding: "0.25rem 0.5rem",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  ".cm-mention-option:hover, .cm-mention-option[aria-selected=true]": {
    backgroundColor: "var(--hover-bg)",
  },
  ".cm-mention-avatar": {
    display: "grid",
    flex: "none",
    width: "1.75rem",
    height: "1.75rem",
    placeItems: "center",
    borderRadius: "50%",
    backgroundColor: "var(--surface-highest)",
    color: "var(--text-secondary)",
    fontSize: "var(--text-2xs)",
    fontWeight: "600",
  },
  ".cm-mention-person": {
    display: "flex",
    minWidth: "0",
    flexDirection: "column",
  },
  ".cm-mention-name, .cm-mention-email": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-mention-name": {
    color: "var(--foreground)",
    fontSize: "var(--text-sm)",
    fontWeight: "500",
  },
  ".cm-mention-email": {
    color: "var(--muted-foreground)",
    fontSize: "var(--text-xs)",
  },
  ".cm-mention-status": {
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    marginTop: "0.25rem",
    borderTop: "1px solid var(--border)",
    padding: "0.375rem 0.5rem 0.125rem",
    color: "var(--muted-foreground)",
    fontSize: "var(--text-xs)",
  },
  ".cm-mention-status.cm-mention-status-alone": {
    marginTop: "0",
    borderTop: "none",
    padding: "0.125rem 0.5rem",
    fontSize: "var(--text-sm)",
  },
  ".cm-mention-spinner": {
    width: "0.75rem",
    height: "0.75rem",
    flex: "none",
    border: "1.5px solid currentColor",
    borderTopColor: "transparent",
    borderRadius: "50%",
    animation: "cm-mention-spin 0.8s linear infinite",
  },
  "@keyframes cm-mention-spin": { to: { transform: "rotate(360deg)" } },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-mention-spinner": { animation: "none" },
  },
});

/**
 * Suggests people after `@`, as Azure DevOps does: a bare @ lists the item's
 * people at once, and the picker stays open while each name is searched,
 * saying "Searching…" over the last answer.
 */
export function mentionPicker(search: () => PeopleSearch): Extension {
  return [
    listboxId,
    mentions,
    pickerKeymap,
    searchPlugin(search),
    pickerTheme,
    EditorView.contentAttributes.compute([mentions], (state) => {
      const picker = visiblePicker(state);
      if (!picker) return { "aria-autocomplete": "list" };
      return {
        "aria-autocomplete": "list",
        "aria-expanded": "true",
        "aria-controls": state.field(listboxId),
        ...(picker.people.length > 0
          ? { "aria-activedescendant": optionId(state, picker.selected) }
          : {}),
      };
    }),
  ];
}
