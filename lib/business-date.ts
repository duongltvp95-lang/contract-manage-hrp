/** A contract DATE is a calendar day in Vietnam, independent of server/browser TZ. */
export const BUSINESS_TIME_ZONE = "Asia/Ho_Chi_Minh";
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export function businessDate(instant: Date = new Date()): string {
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function businessDaysUntil(day: string, instant: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const target = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(target.getTime()) || target.toISOString().slice(0, 10) !== day) return null;
  return Math.round((target.getTime() - Date.parse(`${businessDate(instant)}T00:00:00Z`)) / 86_400_000);
}
