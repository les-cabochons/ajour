import { lazy, Suspense } from "react";

import { cn } from "@/lib/utils";

const MarkdownRenderer = lazy(() => import("@/components/markdown-renderer"));

/**
 * Renders user or source text as GitHub-flavoured markdown. Raw HTML is shown
 * as text and unsafe link protocols are dropped, so synced descriptions cannot
 * inject markup. Single line breaks stay line breaks, so plain-text notes read
 * as they were written. The parser loads on first use; until then the text
 * shows as written.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 text-sm leading-relaxed break-words",
        "[&_li+li]:mt-0.5 [&_li>ol,&_li>ul]:mt-0.5 [&>*+*]:mt-2",
        "[&_ol]:list-decimal [&_ul]:list-disc [&_ul,&_ol]:pl-5",
        "[&_h1]:text-base [&_h1,&_h2,&_h3,&_h4,&_h5,&_h6]:font-medium [&_h2]:text-base",
        "[&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:whitespace-pre [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_hr]:border-border",
        "[&_table]:w-full [&_table]:text-xs [&_td,&_th]:border [&_td,&_th]:px-2 [&_td,&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
        "[&_.task-list-item]:list-none",
        className,
      )}
    >
      <Suspense fallback={<p className="whitespace-pre-line">{children}</p>}>
        <MarkdownRenderer>{children}</MarkdownRenderer>
      </Suspense>
    </div>
  );
}
