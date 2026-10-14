// Entry point: the only file outside code may import. Copy this package as a
// starting point, or delete it.
import { joinWords, splitWords } from "./lib/impl";

/** Turns a free-form title into a URL-safe slug, e.g. "Hello, World!" -> "hello-world". */
export function toSlug(title: string): string {
  return joinWords(splitWords(title), "-");
}
