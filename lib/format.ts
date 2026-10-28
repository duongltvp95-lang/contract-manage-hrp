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

/**
 * Formats contract duration into concise, readable Vietnamese terms:
 * "1 năm", "2 năm", "3 tháng", "6 tháng", "Không xác định thời hạn", or "—".
 * Automatically normalizes long date ranges (e.g. "Từ 15/01/2026 đến 14/01/2027") to "1 năm".
 */
export function formatDuration(
  durationText?: string | null,
  signedDate?: string | null,
  expiryDate?: string | null,
): string {
  const raw = (durationText ?? "").trim();
  const signed = (signedDate ?? "").trim();
  const expiry = (expiryDate ?? "").trim();

  // 1. Không xác định thời hạn
  if (/không\s*xác\s*định|vô\s*thời\s*hạn|không\s*thời\s*hạn|không\s*giới\s*hạn/i.test(raw)) {
    return "Không xác định thời hạn";
  }

  // 2. Trích xuất các ngày dạng YYYY-MM-DD từ chuỗi
  const dates: string[] = [];
  const viDateRegex = /ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/gi;
  let match: RegExpExecArray | null;
  while ((match = viDateRegex.exec(raw)) !== null) {
    dates.push(`${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
  }
  const dmyRegex = /\b(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{4})\b/g;
  while ((match = dmyRegex.exec(raw)) !== null) {
    dates.push(`${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
  }

  const calculateBetween = (startIso: string, endIso: string): string => {
    const d1 = new Date(`${startIso}T00:00:00Z`);
    const d2 = new Date(`${endIso}T00:00:00Z`);
    if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime()) || d2 <= d1) return "";
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 20) return `${diffDays} ngày`;
    let months = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth());
    const dayDiff = d2.getUTCDate() - d1.getUTCDate();
    if (dayDiff >= 25) months += 1;
    else if (dayDiff <= -25) months -= 1;
    const approxMonths = Math.round((diffDays + 1) / 30.4375);
    const finalMonths =
      Math.abs(months - approxMonths) <= 1
        ? approxMonths % 12 === 0
          ? approxMonths
          : months > 0
            ? months
            : approxMonths
        : approxMonths;
    if (finalMonths <= 0) return "";
    if (finalMonths % 12 === 0) return `${finalMonths / 12} năm`;
    return `${finalMonths} tháng`;
  };

  if (dates.length >= 2) {
    const calculated = calculateBetween(dates[0], dates[1]);
    if (calculated) return calculated;
  }

  // 3. Khớp cụm số năm / số tháng
  const yearMatch = raw.match(/\b(0?[1-9]|[1-4][0-9])\s*(?:\([^\)]+\)\s*)?năm\b/i);
  const monthMatch = raw.match(/\b(0?[1-9]|[1-9][0-9])\s*(?:\([^\)]+\)\s*)?tháng\b/i);

  if (yearMatch && monthMatch) {
    return `${parseInt(yearMatch[1], 10)} năm ${parseInt(monthMatch[1], 10)} tháng`;
  }
  if (yearMatch) {
    return `${parseInt(yearMatch[1], 10)} năm`;
  }
  if (monthMatch) {
    const m = parseInt(monthMatch[1], 10);
    if (m > 0 && m % 12 === 0) return `${m / 12} năm`;
    return `${m} tháng`;
  }

  // 4. Nếu chưa có kết quả, tính từ signedDate và expiryDate
  if (signed && expiry) {
    const calculated = calculateBetween(signed, expiry);
    if (calculated) return calculated;
  }

  // 5. Nếu chuỗi ban đầu chứa ngày tháng mà không suy ra được năm/tháng, không hiển thị lại chuỗi ngày
  if (dates.length > 0) {
    return "—";
  }

  return raw || "—";
}
