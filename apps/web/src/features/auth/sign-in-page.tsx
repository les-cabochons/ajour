import { Navigate } from "@tanstack/react-router";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { isDesktopShell } from "@/lib/runtime";
import { useCurrentTeam } from "@/lib/session";
import { cn } from "@/lib/utils";

const features = [
  "Review a day in under 2 minutes",
  "Keep every suggestion explainable",
  "Collect less by default",
];

export function SignInPage() {
  const teamState = useCurrentTeam();

  if (teamState?.team) {
    return <Navigate to="/time/$date" params={{ date: "today" }} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Standalone nav */}
      <nav
        className={cn(
          "harday-nav",
          isDesktopShell && "desktop-shell-nav desktop-drag-region",
        )}
      >
        <div
          className={cn(
            "harday-nav-inner",
            isDesktopShell && "desktop-shell-nav-inner",
          )}
        >
          <BrandLogo
            className={cn(
              "harday-nav-brand",
              isDesktopShell && "desktop-no-drag",
            )}
          />
        </div>
      </nav>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-[400px] animate-in flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col gap-3 text-center">
            <h1 className="text-[20px] font-semibold tracking-[-0.025em] text-foreground">
              Sign in to HarDay
            </h1>
            <p className="mx-auto max-w-xs text-[13px] leading-relaxed text-[var(--text-tertiary)]">
              Automatic daily drafts without creeping into private work.
            </p>
          </div>

          {/* Connect card */}
          <div className="flex flex-col gap-5 rounded-lg border border-[var(--border)] bg-[var(--surface-low)] p-6">
            {/* Feature list */}
            <div className="flex flex-col gap-2">
              {features.map((text, i) => (
                <div
                  key={text}
                  className={cn(
                    "flex animate-in items-center gap-2 text-[13px] text-[var(--text-secondary)]",
                    i === 0
                      ? "animate-in-delay-1"
                      : i === 1
                        ? "animate-in-delay-2"
                        : "animate-in-delay-3",
                  )}
                >
                  <div className="status-dot" />
                  {text}
                </div>
              ))}
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={() => window.location.assign("/time/today")}
            >
              Open workspace
            </Button>

            <p className="text-center text-[11px] text-[var(--text-tertiary)]">
              Local-only mode · No account required
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
