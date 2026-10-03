import { describe, expect, it } from "vitest";

import {
  daysUntil,
  formatBytes,
  formatDateOnly,
  formatDateTime,
  formatExpiryHint,
} from "@/lib/format";

/**
 * Display helpers. `daysUntil` is what the dashboard's "Còn lại" badge is built
 * from, so its behaviour at boundaries matters more than it looks.
 */

describe("formatBytes", () => {
  it("scales through B, KB and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(603)).toBe("603 B");
    expect(formatBytes(225 * 1024)).toBe("225 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("formatDateOnly", () => {
  it("renders a database date as dd/MM/yyyy", () => {
    expect(formatDateOnly("2026-01-15")).toBe("15/01/2026");
  });

  it("shows an em dash for a missing value", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
    expect(formatDateOnly("")).toBe("—");
  });

  it("returns something that is not a date unchanged, rather than mangling it", () => {
    // Splitting "not-a-date" on "-" and reassembling would give "date/a/not",
    // which looks like a date and is not one.
    expect(formatDateOnly("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDateTime", () => {
  it("renders both the date and the time of a timestamp", () => {
    const formatted = formatDateTime("2026-10-03T07:39:31.023Z");
    // Locale ordering and the local hour depend on the machine's ICU and zone,
    // so assert on the presence of the parts rather than the whole string.
    expect(formatted).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  it("shows an em dash for a missing value", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("daysUntil", () => {
  const today = new Date(2026, 9, 3); // 3 October 2026, local midnight

  it("counts whole calendar days", () => {
    expect(daysUntil("2026-10-03", today)).toBe(0);
    expect(daysUntil("2026-10-04", today)).toBe(1);
    expect(daysUntil("2026-10-13", today)).toBe(10);
    expect(daysUntil("2026-09-23", today)).toBe(-10);
  });

  it("is not affected by the time of day the page was rendered", () => {
    // A late-evening render must still say "tomorrow is 1 day away"; a plain
    // millisecond division would say 0 for most of the day.
    const lateEvening = new Date(2026, 9, 3, 23, 59, 0);
    expect(daysUntil("2026-10-04", lateEvening)).toBe(1);
  });

  it("returns null when there is nothing to compare", () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("")).toBeNull();
    expect(daysUntil("nonsense")).toBeNull();
  });
});

describe("formatExpiryHint", () => {
  const today = new Date(2026, 9, 3);

  it("phrases each case in Vietnamese", () => {
    expect(formatExpiryHint("2026-10-03", today)).toBe("Hết hạn hôm nay");
    expect(formatExpiryHint("2026-10-13", today)).toBe("Còn 10 ngày");
    expect(formatExpiryHint("2026-09-23", today)).toBe("Quá hạn 10 ngày");
  });

  it("shows an em dash when there is no expiry date", () => {
    expect(formatExpiryHint(null, today)).toBe("—");
  });
});
