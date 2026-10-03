import { describe, expect, it } from "vitest";

import {
  CreateContractSchema,
  UpdateContractSchema,
  emptyToNull,
  getContractWarnings,
  isRealCalendarDate,
} from "@schemas/contract";

/**
 * W1-WEB-038 — shared validation (plan sections 14, 47).
 *
 * The same schema backs the form and the service, so these assertions are the
 * contract between the two.
 */

describe("isRealCalendarDate", () => {
  it("accepts a real calendar date", () => {
    expect(isRealCalendarDate("2026-01-15")).toBe(true);
    expect(isRealCalendarDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects a date that does not exist", () => {
    // `new Date("2026-02-30")` silently rolls over to 2 March; the helper must not.
    expect(isRealCalendarDate("2026-02-30")).toBe(false);
    expect(isRealCalendarDate("2026-13-01")).toBe(false);
    expect(isRealCalendarDate("2025-02-29")).toBe(false); // not a leap year
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(isRealCalendarDate("15/01/2026")).toBe(false);
    expect(isRealCalendarDate("2026-1-5")).toBe(false);
    expect(isRealCalendarDate("")).toBe(false);
    expect(isRealCalendarDate("tomorrow")).toBe(false);
  });
});

describe("CreateContractSchema", () => {
  const valid = {
    contractNumber: "12/2026/HĐKT",
    signedDate: "2026-01-15",
    durationText: "12 tháng",
    expiryDate: "2027-01-14",
    partnerText: "Công ty TNHH Samsung",
    notes: "ghi chú",
  };

  it("accepts a fully populated contract", () => {
    expect(CreateContractSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an empty form — every field is optional (plan section 45)", () => {
    expect(CreateContractSchema.safeParse({}).success).toBe(true);
    expect(
      CreateContractSchema.safeParse({
        contractNumber: "",
        signedDate: "",
        durationText: "",
        expiryDate: "",
        partnerText: "",
        notes: "",
      }).success,
    ).toBe(true);
  });

  it("rejects an impossible date with a Vietnamese message", () => {
    const result = CreateContractSchema.safeParse({ expiryDate: "2026-02-30" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["expiryDate"]);
      expect(result.error.issues[0]?.message).toContain("YYYY-MM-DD");
    }
  });

  it("rejects a field that is too long", () => {
    expect(
      CreateContractSchema.safeParse({ contractNumber: "x".repeat(101) }).success,
    ).toBe(false);
    expect(
      CreateContractSchema.safeParse({ partnerText: "x".repeat(301) }).success,
    ).toBe(false);
    expect(CreateContractSchema.safeParse({ notes: "x".repeat(5001) }).success).toBe(
      false,
    );
  });

  it("trims surrounding whitespace", () => {
    const result = CreateContractSchema.parse({ partnerText: "  Samsung  " });
    expect(result.partnerText).toBe("Samsung");
  });

  it("ignores an organizationId a client tries to send", () => {
    const result = CreateContractSchema.parse({
      ...valid,
      organizationId: "22222222-2222-2222-2222-222222222222",
    });
    // Not part of the shape, so it is stripped rather than honoured.
    expect(result).not.toHaveProperty("organizationId");
  });
});

describe("UpdateContractSchema", () => {
  it("is the same schema as create — one form, one rule set (plan section 65)", () => {
    expect(UpdateContractSchema).toBe(CreateContractSchema);
  });
});

describe("emptyToNull", () => {
  it("turns an untouched form input into SQL NULL", () => {
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull(null)).toBeNull();
  });

  it("keeps and trims a real value", () => {
    expect(emptyToNull("  Samsung  ")).toBe("Samsung");
  });
});

describe("getContractWarnings (plan section 47)", () => {
  it("warns when expiry precedes signing, without blocking the save", () => {
    const warnings = getContractWarnings({
      signedDate: "2026-06-01",
      expiryDate: "2026-01-01",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("sớm hơn ngày ký");
  });

  it("stays silent when the order is right", () => {
    expect(
      getContractWarnings({ signedDate: "2026-01-01", expiryDate: "2027-01-01" }),
    ).toEqual([]);
  });

  it("stays silent when either date is missing or malformed", () => {
    expect(getContractWarnings({ signedDate: "2026-06-01" })).toEqual([]);
    expect(getContractWarnings({ expiryDate: "2026-01-01" })).toEqual([]);
    expect(
      getContractWarnings({ signedDate: "not-a-date", expiryDate: "2026-01-01" }),
    ).toEqual([]);
  });
});
