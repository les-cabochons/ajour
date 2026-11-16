import { useId } from "react";
import {
  RiExternalLinkLine as External,
  RiSparkling2Line as Sparkle,
} from "@remixicon/react";
import { MessagePanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import type { UpdateTrack } from "@/domain/local-state";
import type { ReleaseChange, ReleaseChangeKind } from "@/domain/release-notes";
import {
  applyDesktopUpdate,
  isDesktopUpdateBusy,
  useDesktopUpdates,
} from "@/lib/desktop-updates";
import { useUserPreferences } from "@/lib/local-hooks";
import {
  ALL_RELEASES_URL,
  useReleaseNotes,
  type Release,
} from "@/lib/release-notes";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<ReleaseChangeKind, string> = {
  new: "New",
  fix: "Fix",
  improved: "Faster",
  change: "Change",
};

/**
 * Settings › What's new, opened from the version at the foot of the
 * Settings window and from the gear's menu while an update waits. The update
 * waiting to install heads the page with its changes and Update and restart.
 * The track's other latest releases follow as a timeline, the installed one
 * marked. Every release links to GitHub and every change to its pull request.
 */
export function SettingsWhatsNewPage() {
  const { updateTrack } = useUserPreferences();
  const [notes, retry] = useReleaseNotes(updateTrack);
  const update = useDesktopUpdates();
  const installed = window.ajourDesktop?.runtime?.version;
  const waiting =
    update.result?.updateAvailable && update.track === updateTrack
      ? update.result.latestVersion
      : null;
  const releases = notes.status === "ready" ? notes.releases : [];
  const waitingRelease = waiting
    ? releases.find((release) => release.packageVersion === waiting)
    : undefined;
  const timeline = releases.filter((release) => release !== waitingRelease);

  return (
    <section className="settings-section">
      <p className="settings-section-desc">
        {notes.status === "unavailable"
          ? "Release notes are published with each release on GitHub. "
          : `The latest ${trackName(updateTrack)} releases. `}
        <ExternalLink href={ALL_RELEASES_URL}>
          All releases on GitHub
        </ExternalLink>
      </p>

      {waitingRelease ? (
        <WaitingUpdate release={waitingRelease} track={updateTrack} />
      ) : null}

      {notes.status === "loading" ? <TimelineSkeleton /> : null}
      {notes.status === "error" ? (
        <MessagePanel className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">Couldn't load the release notes.</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </MessagePanel>
      ) : null}
      {notes.status === "ready" ? (
        <ol aria-label="Releases" className="whats-new-timeline">
          {timeline.map((release) => (
            <li
              key={release.packageVersion}
              data-release={release.packageVersion}
              data-installed={
                release.packageVersion === installed ? "" : undefined
              }
              className="whats-new-release"
            >
              <ReleaseHeading
                release={release}
                track={updateTrack}
                installed={release.packageVersion === installed}
              />
              <ChangeList changes={release.changes} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** The update waiting to install, heading the page with Update and restart. */
function WaitingUpdate({
  release,
  track,
}: {
  release: Release;
  track: UpdateTrack;
}) {
  const update = useDesktopUpdates();
  const headingId = useId();
  const busy = isDesktopUpdateBusy(update);
  return (
    <section aria-labelledby={headingId} className="whats-new-update">
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        <Sparkle aria-hidden className="size-4 shrink-0 text-primary" />
        <h2 id={headingId} className="text-sm font-medium text-foreground">
          {release.label} is ready
        </h2>
        <ReleaseDate release={release} track={track} />
        <Button
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={() => void applyDesktopUpdate(update)}
        >
          {update.status === "downloading"
            ? `Downloading ${update.progress ?? 0}%`
            : update.canInstall
              ? "Update and restart"
              : "View release"}
        </Button>
      </div>
      <ChangeList changes={release.changes} />
      <ExternalLink
        href={release.releaseUrl}
        aria-label={`${release.label} on GitHub`}
        className="mt-1 inline-flex"
      >
        GitHub
      </ExternalLink>
    </section>
  );
}

function ReleaseHeading({
  release,
  track,
  installed,
}: {
  release: Release;
  track: UpdateTrack;
  installed: boolean;
}) {
  return (
    <div className="flex h-7 items-center gap-2">
      <h2 className="text-sm font-medium text-foreground">{release.label}</h2>
      {installed ? <Chip tone="success">Installed</Chip> : null}
      <ReleaseDate release={release} track={track} />
      <ExternalLink
        href={release.releaseUrl}
        aria-label={`${release.label} on GitHub`}
        className="ml-auto"
      >
        GitHub
      </ExternalLink>
    </div>
  );
}

function ReleaseDate({
  release,
  track,
}: {
  release: Release;
  track: UpdateTrack;
}) {
  const date = new Date(release.publishedAt);
  return (
    <time
      dateTime={release.publishedAt}
      className="text-xs whitespace-nowrap text-muted-foreground"
    >
      {new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        ...(track === "nightly"
          ? { hour: "numeric", minute: "2-digit" }
          : { year: "numeric" }),
      }).format(date)}
    </time>
  );
}

function ChangeList({ changes }: { changes: ReleaseChange[] }) {
  if (changes.length === 0)
    return (
      <p className="py-1 text-[13px] text-muted-foreground">
        Maintenance only: nothing you'd notice.
      </p>
    );
  return (
    <ul className="flex flex-col">
      {changes.map((change, index) => (
        <li
          key={`${change.pullNumber ?? "change"}-${index}`}
          className="flex items-baseline gap-3 py-1 text-[13px] leading-5"
        >
          <span
            className={cn(
              "w-12 shrink-0 text-xs font-medium",
              change.kind === "new" ? "text-primary" : "text-muted-foreground",
            )}
          >
            {KIND_LABELS[change.kind]}
          </span>
          <span className="min-w-0 flex-1 text-foreground">
            {change.area ? (
              <span className="text-muted-foreground">{change.area} · </span>
            ) : null}
            {change.summary}
          </span>
          {change.pullUrl ? (
            <a
              href={change.pullUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Pull request ${change.pullNumber}`}
              className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground hover:underline"
            >
              #{change.pullNumber}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ExternalLink({
  className,
  children,
  ...props
}: React.ComponentProps<"a">) {
  return (
    <a
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline",
        className,
      )}
      {...props}
    >
      {children}
      <External aria-hidden className="size-3" />
    </a>
  );
}

function TimelineSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading releases"
      className="flex flex-col gap-4"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}

function trackName(track: UpdateTrack) {
  return track === "nightly" ? "nightly" : "stable";
}
