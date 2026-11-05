import { describe, expect, it } from "vitest";
import { addCalendarDays, businessDate, businessDaysUntil } from "@/lib/business-date";
import { resolveExpiryPreset } from "@/lib/contracts-query";
import { formatDateTime } from "@/lib/format";

describe("Vietnam contract calendar", () => {
  it("changes day at midnight Vietnam, not UTC", () => {
    expect(businessDate(new Date("2026-10-30T16:59:59Z"))).toBe("2026-10-30");
    expect(businessDate(new Date("2026-10-30T17:00:00Z"))).toBe("2026-10-31");
    expect(businessDaysUntil("2026-10-30", new Date("2026-10-30T18:00:00Z"))).toBe(-1);
  });
  it("calculates date ranges across month/year boundaries", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(resolveExpiryPreset("expired", new Date("2026-10-30T18:00:00Z"))).toEqual({ lt: "2026-10-31" });
    expect(resolveExpiryPreset("expiring30", new Date("2026-12-31T18:00:00Z")))
      .toEqual({ gte: "2027-01-01", lte: "2027-01-31" });
  });
  it("rejects invalid calendar dates and formats timestamps in Vietnam", () => {
    expect(businessDaysUntil("2026-02-30")).toBeNull();
    expect(formatDateTime("2026-10-30T18:00:00Z")).toContain("31/10/2026");
    expect(formatDateTime("2026-10-30T18:00:00Z")).toContain("01:00");
  });
});
