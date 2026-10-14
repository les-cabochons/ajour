import { useEffect, type MouseEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { registerPageHeader, usePageHeaderSlot } from "@/lib/page-header";
import { cn } from "@/lib/utils";

/**
 * A page's title or breadcrumb and its actions, shown in the top bar. List
 * pages give a `title`; detail pages give a `breadcrumb` and keep the object's
 * title in the content. `actions` sit after the title, before the global
 * entry controls. Renders through a portal into the shell's slot.
 */
export function PageHeader({
  title,
  meta,
  breadcrumb,
  actions,
  children,
}: {
  title?: ReactNode;
  /** A muted count after the title, such as the number of listed items. */
  meta?: ReactNode;
  breadcrumb?: PageBreadcrumbItem[];
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
  if (!slot) {
    return <div className="ajour-page-header-inline">{content}</div>;
  }

  return createPortal(content, slot);
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
  label: ReactNode;
  /** The route the crumb opens. The last crumb has none: it is the current page. */
  to?: string;
  /** Set on the object's own id or key, shown in the mono value style. */
  mono?: boolean;
  /** Runs before the crumb's navigation; call `preventDefault` to stay. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/** "Backlog / #48190": every crumb but the last links back. */
export function PageBreadcrumb({ items }: { items: PageBreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="ajour-page-breadcrumb">
      <ol>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const label = (
            <span className={cn(item.mono && "font-mono")}>{item.label}</span>
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
                  className="ajour-page-breadcrumb-link"
                  onClick={item.onClick}
                >
                  {label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(isLast && "ajour-page-breadcrumb-current")}
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
