import { useMemo, type ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { Checkbox } from "@/components/ui/checkbox";

const remarkPlugins = [remarkGfm, remarkBreaks];

// Links leave the app for the system browser; relative ones would open the
// app's own address there, so they stay text.
const isExternalUrl = (url: string | undefined): url is string =>
  url !== undefined && /^(https?|mailto):/i.test(url);

// A plugin writes a mention as `[@Name](mention:<id>)`. The id stays opaque.
const isMention = (url: string | undefined) =>
  url !== undefined && url.startsWith("mention:");

// An answer's `path:line` on Deck's review page, which scrolls to its line.
const isCitation = (url: string | undefined): url is string =>
  url !== undefined && url.startsWith("citation:");

// The default drops unknown protocols; mentions keep theirs to show as
// chips, and citations theirs to show as buttons where the page reads them.
const urlTransform = (url: string) =>
  isMention(url) || isCitation(url) ? url : defaultUrlTransform(url);

const link = ({ href, children }: { href?: string; children?: ReactNode }) =>
  isMention(href) ? (
    <span className="rounded-sm bg-[var(--indigo-muted)] px-0.5 font-medium text-primary">
      {children}
    </span>
  ) : isExternalUrl(href) ? (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );

const components: Components = {
  a: link,
  // Remote images would be fetched as soon as a note shows, so they become
  // links the user chooses to open.
  img: ({ src, alt }) => {
    const label = alt || (typeof src === "string" ? src : "") || "Image";
    return typeof src === "string" && isExternalUrl(src) ? (
      <a href={src} target="_blank" rel="noreferrer">
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  },
  // A table can't shrink below its longest word, such as a tracking URL in an
  // email pasted into a source description, so a wide one scrolls sideways
  // in its column instead of running under what sits beside it.
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <Checkbox
        checked={Boolean(checked)}
        readOnly
        className="mr-1.5 inline-flex align-middle"
      />
    ) : null,
};

/** The markdown stack behind `Markdown`, split out so it loads on first use. */
export default function MarkdownRenderer({
  children,
  onCitation,
}: {
  children: string;
  onCitation?: (href: string) => void;
}) {
  const withCitations = useMemo((): Components => {
    if (!onCitation) return components;
    return {
      ...components,
      a: (props) =>
        isCitation(props.href) ? (
          <button
            type="button"
            className="markdown-citation"
            onClick={() => onCitation(props.href!)}
          >
            {props.children}
          </button>
        ) : (
          link({ href: props.href, children: props.children })
        ),
    };
  }, [onCitation]);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={withCitations}
      urlTransform={urlTransform}
    >
      {children}
    </ReactMarkdown>
  );
}
