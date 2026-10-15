import { useEffect, type MouseEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { RiArrowLeftLine as ArrowLeft } from "@remixicon/react";
import { registerPageHeader, usePageHeaderSlot } from "@/lib/page-header";
import { cn } from "@/lib/utils";

/**
 * A page's title and actions, shown in the top bar through the shell's slot.
 * Detail pages keep their title and optional back link in the page content.
 */
export function PageHeader({
  title,
  meta,
  backLink,
  actions,
  children,
}: {
  title?: ReactNode;
  /** A muted count after the title, such as the number of listed items. */
  meta?: ReactNode;
  backLink?: PageBackLink;
  actions?: ReactNode;
  /** Controls that belong with the title, such as a date switcher. */
  children?: ReactNode;
}) {
  const slot = usePageHeaderSlot();
  useEffect(() => registerPageHeader(), []);

  const content = (
    <>
      <div className="ajour-page-header-title">
        {title !== undefined ? (
          <PageTitle meta={meta}>{title}</PageTitle>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="ajour-page-header-actions">{actions}</div>
      ) : null}
    </>
  );

  // The narrow view's titlebar holds the section switcher, not a slot: the
  // header renders where the page put it instead, as the page's first row.
  return (
    <>
      {slot ? (
        createPortal(content, slot)
      ) : (
        <div className="ajour-page-header-inline">{content}</div>
      )}
      {backLink ? (
        <Link
          to={backLink.to}
          onClick={backLink.onClick}
          className="inline-flex h-7 w-fit items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Back to {backLink.label}
        </Link>
      ) : null}
    </>
  );
}

/**
 * The page's name in the top bar, with an optional muted count or meta after
 * it. It is the page's `h1`; the shell's default title renders a `div` so a
 * page that still has its own heading keeps one `h1`.
 */
export function PageTitle({
  children,
  meta,
  className,
  as: Heading = "h1",
}: {
  children: ReactNode;
  meta?: ReactNode;
  className?: string;
  as?: "h1" | "div";
}) {
  return (
    <>
      <Heading className={cn("ajour-page-title", className)}>
        <span className="truncate">{children}</span>
      </Heading>
      {meta !== undefined ? (
        <span className="ajour-page-title-meta">{meta}</span>
      ) : null}
    </>
  );
}

export interface PageBackLink {
  label: string;
  to: string;
  /** Runs before navigation; call `preventDefault` to stay. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}
