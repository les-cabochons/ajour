import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** A route that loads faster than this shows no skeleton, so fast loads never flash. */
const PAGE_SKELETON_DELAY_MS = 150;

const ROW_COUNT = 6;

/**
 * The fallback while a route's code loads: a header and a list of rows, the
 * shape every page shares. It renders nothing for the first 150ms.
 */
export function PageSkeleton() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setIsVisible(true),
      PAGE_SKELETON_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="flex w-full flex-col gap-4 p-6"
      role="status"
      aria-label="Loading page"
      data-slot="page-skeleton"
    >
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-7 w-48 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: ROW_COUNT }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
