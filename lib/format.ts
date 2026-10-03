/** Formatting helpers shared by server and client code. */

import { differenceInCalendarDays, parseISO } from "date-fns";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `2026-01-15` -> `15/01/2026`. Database dates are plain `YYYY-MM-DD`.
 *
 * Anything that is not that exact shape is returned unchanged rather than
 * mangled: splitting "not-a-date" on "-" and reassembling it would produce
 * "date/a/not", which looks like a date and is not one. In practice the value
 * always comes from a PostgreSQL `date` column, so the branch is a safety net.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Whole calendar days from `today` until a `YYYY-MM-DD` date; negative once the
 * date has passed. `null` when there is nothing to compare.
 *
 * `parseISO` reads a date-only string as local midnight and
 * `differenceInCalendarDays` compares calendar days, so a contract expiring
 * "tomorrow" reports 1 regardless of the hour the page was rendered — a plain
 * millisecond division would drift by one for most of the day.
 */
export function daysUntil(
  value: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!value) return null;
  const target = parseISO(value);
  if (Number.isNaN(target.getTime())) return null;
  return differenceInCalendarDays(target, today);
}

/** Human phrasing for the "Expiring" column on the dashboard. */
export function formatExpiryHint(
  value: string | null | undefined,
  today: Date = new Date(),
): string {
  const days = daysUntil(value, today);
  if (days === null) return "—";
  if (days < 0) return `Quá hạn ${Math.abs(days)} ngày`;
  if (days === 0) return "Hết hạn hôm nay";
  return `Còn ${days} ngày`;
}
