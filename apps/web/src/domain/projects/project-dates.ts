import type { LocalProject } from "@/domain/local-state";
import {
  formatShortLocalDate,
  isValidLocalDate,
} from "@/domain/time/local-date";

/*
 * A managed project's dates, as its project source gives them (#508). Both
 * are `YYYY-MM-DD` days and either may be missing. Nothing here is stored.
 */

type ProjectDates = Pick<LocalProject, "startsOn" | "endsOn">;

function validDay(value: string | undefined) {
  return value && isValidLocalDate(value) ? value : undefined;
}

/**
 * The project's dates as one value, such as "Jan 1 – Dec 31", with the year
 * when it is not `currentYear`, once when both days share it: "Feb 2 – Oct
 * 31, 2025". A start alone reads "Jan 1 –" and an end alone "– Dec 31".
 * Undefined when the source gave neither.
 */
export function formatProjectDates(
  project: ProjectDates,
  currentYear: number,
): string | undefined {
  const startsOn = validDay(project.startsOn);
  const endsOn = validDay(project.endsOn);
  if (!startsOn && !endsOn) return undefined;
  // The end gives the year the start shares with it, so it shows once.
  const startYear =
    startsOn && endsOn && startsOn.slice(0, 4) === endsOn.slice(0, 4)
      ? Number(startsOn.slice(0, 4))
      : currentYear;
  const start = startsOn ? formatShortLocalDate(startsOn, startYear) : "";
  const end = endsOn ? formatShortLocalDate(endsOn, currentYear) : "";
  return `${start} – ${end}`.trim();
}

/**
 * The project's last day once `today` is past it, such as "Oct 31, 2025",
 * else undefined.
 */
export function getProjectEndedOn(
  project: ProjectDates,
  today: string,
  currentYear: number,
): string | undefined {
  const endsOn = validDay(project.endsOn);
  return endsOn && endsOn < today
    ? formatShortLocalDate(endsOn, currentYear)
    : undefined;
}
