import { useEffect, type MouseEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { RiArrowLeftLine as ArrowLeft } from "@remixicon/react";
import { registerPageHeader, usePageHeaderSlot } from "@/lib/page-header";
import { cn } from "@/lib/utils";

/**
 * A page's title or breadcrumb and its actions, shown in the top bar through
 * the shell's slot. Detail pages keep their title and optional back link in
 * the page content.
 */
export function PageHeader({
  title,
  meta,
  breadcrumb,
  backLink,
  actions,
  children,
}: {
  title?: ReactNode;
  /** A muted count after the title, such as the number of listed items. */
  meta?: ReactNode;
  /** Where a detail page sits, such as its project, in place of a title. */
  breadcrumb?: PageBreadcrumbItem[];
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
        {breadcrumb ? (
          <PageBreadcrumb items={breadcrumb} />
        ) : title !== undefined ? (
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
  // A header with only a back link, like the project page's, adds no row.
  const hasContent =
    title !== undefined ||
    breadcrumb !== undefined ||
    children !== undefined ||
    actions !== undefined;
  return (
    <>
      {slot ? (
        createPortal(content, slot)
      ) : hasContent ? (
        <div className="ajour-page-header-inline">{content}</div>
      ) : null}
      {backLink ? (
        <Link
          to={backLink.to}
          search={backLink.search as never}
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

export interface PageBreadcrumbItem {
  label: string;
  /** Drawn before the label, such as the project's icon. */
  icon?: ReactNode;
  /** The route the crumb opens. The last crumb has none: it is the current page. */
  to?: string;
  /** Path params of `to`, such as the project's id. */
  params?: Record<string, string>;
}

/** "ajour / Build latest main": every crumb but the last links to its page. */
function PageBreadcrumb({ items }: { items: PageBreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="ajour-page-breadcrumb">
      <ol>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const label = (
            <>
              {item.icon}
              <span className="truncate">{item.label}</span>
            </>
          );
          return (
            <li key={index}>
              {index > 0 ? (
                <span aria-hidden="true" className="ajour-page-breadcrumb-sep">
                  /
                </span>
              ) : null}
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  params={item.params as never}
                  className="ajour-page-breadcrumb-link"
                >
                  {label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className="ajour-page-breadcrumb-current"
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageBackLink {
  label: string;
  to: string;
  /** Search params of `to`, such as the Week view of a Time day. */
  search?: Record<string, unknown>;
  /** Runs before navigation; call `preventDefault` to stay. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}
