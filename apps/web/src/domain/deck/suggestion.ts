/*
 * Suggested changes (#785): a comment on lines of the head can carry a
 * `suggestion` block, the lines as the reviewer would have them, which
 * GitHub and Azure DevOps both show with a way to apply it. The block
 * starts as the lines' current text, for the reviewer to edit.
 */

/** `body` with a suggestion block for `lineText`, the commented lines' text, at its end. */
export function withSuggestion(body: string, lineText: string): string {
  const longest = Math.max(
    0,
    ...[...lineText.matchAll(/`+/g)].map((run) => run[0].length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  const block = `${fence}suggestion\n${lineText}\n${fence}`;
  const before = body.trimEnd();
  return before ? `${before}\n\n${block}` : block;
}
