type InlineEditorContainer = {
  contains: (target: Node | null) => boolean;
};

export function isInlineEditorOutsideClick(
  target: EventTarget | null,
  container: InlineEditorContainer | null,
  ignoredSelectors: string[] = [],
) {
  if (!target || !container) {
    return true;
  }

  try {
    if (container.contains(target as Node | null)) {
      return false;
    }
  } catch {
    // Ignore non-Node targets in test and browser edge cases.
  }

  if (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  ) {
    const targetElement = target as Element;

    if (
      targetElement.closest(".searchable-select-popover") ||
      targetElement.closest(".project-task-picker-popover") ||
      ignoredSelectors.some((selector) => targetElement.closest(selector))
    ) {
      return false;
    }
  }

  return true;
}
