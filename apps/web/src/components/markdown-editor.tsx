import { lazy, Suspense, type CSSProperties } from "react";

import type { MarkdownEditorProps } from "@/components/markdown-editor-view";
import { cn } from "@/lib/utils";

const loadMarkdownEditorView = () =>
  import("@/components/markdown-editor-view");
const MarkdownEditorView = lazy(loadMarkdownEditorView);

/** Starts downloading the editor, such as when the pointer reaches an Edit button. */
export function preloadMarkdownEditor() {
  void loadMarkdownEditorView();
}

/**
 * The one editor for Markdown text: descriptions now, comments and notes
 * later. The text stays Markdown while it shows styled, so saving changes only
 * what the user typed. CodeMirror loads on first use; until then the text shows
 * as written in the same frame.
 */
export function MarkdownEditor({
  className,
  ...props
}: MarkdownEditorProps & { className?: string }) {
  return (
    <div
      className={cn(
        "w-full rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 py-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
        className,
      )}
    >
      <Suspense
        fallback={
          <p
            className="min-h-[calc(var(--lines)*1.55em)] text-sm leading-[1.55] whitespace-pre-wrap"
            style={{ "--lines": props.minLines ?? 3 } as CSSProperties}
          >
            {props.value ?? props.defaultValue ?? ""}
          </p>
        }
      >
        <MarkdownEditorView {...props} />
      </Suspense>
    </div>
  );
}
