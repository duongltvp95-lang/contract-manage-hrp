import { describe, expect, it } from "vitest";

import { PartnerSchema, UpdatePartnerSchema } from "@schemas/partner";

/**
 * Feature round 2, part 1 + part 3 + round 10, part 1 — shared partner
 * validation.
 *
 * The same schema backs the form and the service, so these assertions are the
 * contract between the two. The rules mirror the database CHECK constraints:
 *   * name:    1-200 characters after trimming;
 *   * address: optional, 1-500 characters after trimming;
 *   * taxCode: optional, VN shape (10 digits, optional -NNN branch suffix);
 *   * status:  optional enum, defaults to `active` at the service layer;
 *   * companyIds: required, at least one uuid (round 10).
 */

const HRP = "00000000-0000-4000-8000-000000000001";

describe("PartnerSchema", () => {
  it("accepts a normal name", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty TNHH Samsung Electronics Việt Nam",
      companyIds: [HRP],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe(
      "Công ty TNHH Samsung Electronics Việt Nam",
    );
  });

  it("trims surrounding whitespace", () => {
    const parsed = PartnerSchema.safeParse({ name: "  Công ty ABC  ", companyIds: [HRP] });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Công ty ABC");
  });

  it("rejects an empty name", () => {
    expect(PartnerSchema.safeParse({ name: "", companyIds: [HRP] }).success).toBe(false);
    expect(PartnerSchema.safeParse({ companyIds: [HRP] }).success).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    // Trimming happens before the length rule, so spaces are not a name — the
    // same thing the database CHECK enforces.
    expect(PartnerSchema.safeParse({ name: "     ", companyIds: [HRP] }).success).toBe(false);
  });

  it("accepts exactly 200 characters and rejects 201", () => {
    expect(PartnerSchema.safeParse({ name: "a".repeat(200), companyIds: [HRP] }).success).toBe(true);
    expect(PartnerSchema.safeParse({ name: "a".repeat(201), companyIds: [HRP] }).success).toBe(false);
  });

  it("measures length after trimming, not before", () => {
    const padded = `  ${"a".repeat(200)}  `;

    expect(PartnerSchema.safeParse({ name: padded, companyIds: [HRP] }).success).toBe(true);
  });

  it("reports a Vietnamese message for the length rule", () => {
    const parsed = PartnerSchema.safeParse({ name: "a".repeat(201), companyIds: [HRP] });

    expect(parsed.error?.issues[0]?.message).toBe("Tên đối tác tối đa 200 ký tự");
  });

  // Round 2 part 3 — optional fields.

  it("accepts a partner with no optional fields", () => {
    const parsed = PartnerSchema.safeParse({ name: "Công ty A", companyIds: [HRP] });

    expect(parsed.success).toBe(true);
  });

  it("accepts a partner with address and tax code", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty B",
      address: "Số 9, đường Bắc Hà, Hà Nội",
      taxCode: "0123456789",
      companyIds: [HRP],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts an empty address and tax code as 'left blank'", () => {
    // The form sends "" for an empty optional; Zod accepts it without the
    // client having to omit the key. The service normalises both to null.
    const parsed = PartnerSchema.safeParse({
      name: "Công ty C",
      address: "",
      taxCode: "",
      companyIds: [HRP],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an address longer than 500 characters", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty D",
      address: "a".repeat(501),
      companyIds: [HRP],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Địa chỉ tối đa 500 ký tự");
  });

  it("accepts a tax code with a -NNN branch suffix", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty E",
      taxCode: "0123456789-001",
      companyIds: [HRP],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a tax code that is not 10 digits", () => {
    expect(PartnerSchema.safeParse({ name: "F", taxCode: "123456789", companyIds: [HRP] }).success).toBe(false);
    expect(PartnerSchema.safeParse({ name: "F", taxCode: "01234567890", companyIds: [HRP] }).success).toBe(false);
  });

  it("rejects a tax code that contains non-digits", () => {
    expect(
      PartnerSchema.safeParse({ name: "F", taxCode: "012345678a", companyIds: [HRP] }).success,
    ).toBe(false);
  });

  it("rejects a tax code branch suffix that is not 3 digits", () => {
    expect(
      PartnerSchema.safeParse({ name: "F", taxCode: "0123456789-1", companyIds: [HRP] }).success,
    ).toBe(false);
    expect(
      PartnerSchema.safeParse({ name: "F", taxCode: "0123456789-0001", companyIds: [HRP] }).success,
    ).toBe(false);
  });

  // Round 10 — status + companies.

  it("defaults status to undefined (the service fills 'active')", () => {
    const parsed = PartnerSchema.safeParse({ name: "Công ty G", companyIds: [HRP] });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.status).toBeUndefined();
  });

  it("accepts an explicit status and rejects an unknown one", () => {
    expect(
      PartnerSchema.safeParse({ name: "G", status: "active", companyIds: [HRP] }).success,
    ).toBe(true);
    expect(
      PartnerSchema.safeParse({ name: "G", status: "stopped", companyIds: [HRP] }).success,
    ).toBe(true);
    expect(
      PartnerSchema.safeParse({ name: "G", status: "paused", companyIds: [HRP] }).success,
    ).toBe(false);
  });

  it("requires at least one company and rejects an empty list", () => {
    expect(PartnerSchema.safeParse({ name: "G", companyIds: [] }).success).toBe(false);
    expect(PartnerSchema.safeParse({ name: "G" }).success).toBe(false);
  });

  it("accepts both companies and rejects a non-uuid company id", () => {
    expect(
      PartnerSchema.safeParse({ name: "G", companyIds: [HRP, "00000000-0000-4000-8000-000000000002"] })
        .success,
    ).toBe(true);
    expect(PartnerSchema.safeParse({ name: "G", companyIds: ["not-a-uuid"] }).success).toBe(false);
  });
});

describe("UpdatePartnerSchema", () => {
  it("accepts a partial payload with no name", () => {
    expect(UpdatePartnerSchema.safeParse({}).success).toBe(true);
  });

  it("applies the same rules when a name is sent", () => {
    expect(UpdatePartnerSchema.safeParse({ name: "Tên mới" }).success).toBe(true);
    expect(UpdatePartnerSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(UpdatePartnerSchema.safeParse({ name: "a".repeat(201) }).success).toBe(false);
  });

  it("accepts a partial payload that only changes the address", () => {
    const parsed = UpdatePartnerSchema.safeParse({
      address: "Số 1, đường Lê Lợi, TP.HCM",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a partial payload that only changes the tax code", () => {
    const parsed = UpdatePartnerSchema.safeParse({
      taxCode: "0123456789",
    });

    expect(parsed.success).toBe(true);
  });

  it("applies the VN shape rule to an updated tax code", () => {
    expect(
      UpdatePartnerSchema.safeParse({ taxCode: "not-a-code" }).success,
    ).toBe(false);
  });

  it("accepts a status change and rejects an unknown status", () => {
    expect(UpdatePartnerSchema.safeParse({ status: "stopped" }).success).toBe(true);
    expect(UpdatePartnerSchema.safeParse({ status: "paused" }).success).toBe(false);
  });

  it("accepts companyIds (min 1) and rejects an empty list", () => {
    expect(UpdatePartnerSchema.safeParse({ companyIds: [HRP] }).success).toBe(true);
    expect(UpdatePartnerSchema.safeParse({ companyIds: [] }).success).toBe(false);
  });
});
