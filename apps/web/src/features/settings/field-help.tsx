import { useState } from "react";
import { FieldDescription } from "@/components/ui/field";

/** Help longer than this shows its first sentence, and the rest on demand. */
const SHORT_HELP_LENGTH = 120;

/** The first sentence of `text`, and what follows it. */
export function splitFirstSentence(text: string) {
  const match = text.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  return match
    ? { first: match[1]!, rest: match[2]! }
    : { first: text, rest: "" };
}

/**
 * A field's help. Short help shows whole; long help shows its first sentence
 * and a More button that reveals the rest in place, so a form's labels and
 * inputs carry its shape, not paragraphs of setup notes.
 */
export function FieldHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { first, rest } = splitFirstSentence(text.trim());
  if (text.length <= SHORT_HELP_LENGTH || !rest) {
    return <FieldDescription>{text}</FieldDescription>;
  }
  return (
    <FieldDescription>
      {open ? text : first}{" "}
      <button
        type="button"
        className="font-medium text-foreground/80 hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Less" : "More"}
      </button>
    </FieldDescription>
  );
}
