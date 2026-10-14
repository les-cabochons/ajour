import { cn } from "@/lib/utils";

/**
 * The running indicator: a green dot with a ring that scales and fades on the
 * compositor. Animating box-shadow repainted the titlebar every frame.
 */
export function RunningDot({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative flex size-2 shrink-0", className)}
      aria-hidden="true"
    >
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--success)]" />
    </span>
  );
}
