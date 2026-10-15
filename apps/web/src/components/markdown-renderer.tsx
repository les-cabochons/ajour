import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { Checkbox } from "@/components/ui/checkbox";

const remarkPlugins = [remarkGfm, remarkBreaks];

// Links leave the app for the system browser; relative ones would open the
// app's own address there, so they stay text.
const isExternalUrl = (url: string | undefined): url is string =>
  url !== undefined && /^(https?|mailto):/i.test(url);

const components: Components = {
  a: ({ href, children }) =>
    isExternalUrl(href) ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
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
export default function MarkdownRenderer({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </ReactMarkdown>
  );
}
