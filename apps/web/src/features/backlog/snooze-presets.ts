/**
 * The Snooze… choices from "Backlog sidebar" in agents/ux-spec.md. The clock
 * times are fixed: Ajour has no workday setting.
 */
export interface SnoozePreset {
  label: string;
  until: number;
}

const HOUR_MS = 3_600_000;

function atHour(from: Date, daysAhead: number, hour: number) {
  const date = new Date(from);
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

/**
 * In an hour, In 3 hours, This afternoon (13:00, before noon only), Tomorrow
 * (9:00 the next calendar day) and Next week (Monday 9:00).
 */
export function getSnoozePresets(now: number): SnoozePreset[] {
  const today = new Date(now);
  const daysToMonday = (8 - today.getDay()) % 7 || 7;
  const presets: SnoozePreset[] = [
    { label: "In an hour", until: now + HOUR_MS },
    { label: "In 3 hours", until: now + 3 * HOUR_MS },
  ];

  if (today.getHours() < 12) {
    presets.push({ label: "This afternoon", until: atHour(today, 0, 13) });
  }

  presets.push(
    { label: "Tomorrow", until: atHour(today, 1, 9) },
    { label: "Next week", until: atHour(today, daysToMonday, 9) },
  );
  return presets;
}

/** "Today 1:00 p.m.", "Tomorrow 9:00 a.m." or "Mon, Oct 19 9:00 a.m.". */
export function formatSnoozeTime(until: number, now: number) {
  const date = new Date(until);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const dayDelta = Math.round(
    (atHour(date, 0, 0) - atHour(new Date(now), 0, 0)) / (24 * HOUR_MS),
  );

  if (dayDelta === 0) return `Today ${time}`;
  if (dayDelta === 1) return `Tomorrow ${time}`;
  return `${date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} ${time}`;
}
