import { describe, expect, it } from "vitest";

import { PartnerSchema, UpdatePartnerSchema } from "@schemas/partner";

/**
 * Feature round 2, part 1 + part 3 — shared partner validation.
 *
 * The same schema backs the form and the service, so these assertions are the
 * contract between the two. The rules mirror the database CHECK constraints:
 *   * name:    1-200 characters after trimming;
 *   * address: optional, 1-500 characters after trimming;
 *   * taxCode: optional, VN shape (10 digits, optional -NNN branch suffix).
 *
 * Round 2 part 3 added two optional fields per the Owner decision (T6).
 */

describe("PartnerSchema", () => {
  it("accepts a normal name", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty TNHH Samsung Electronics Việt Nam",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe(
      "Công ty TNHH Samsung Electronics Việt Nam",
    );
  });

  it("trims surrounding whitespace", () => {
    const parsed = PartnerSchema.safeParse({ name: "  Công ty ABC  " });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Công ty ABC");
  });

  it("rejects an empty name", () => {
    expect(PartnerSchema.safeParse({ name: "" }).success).toBe(false);
    expect(PartnerSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    // Trimming happens before the length rule, so spaces are not a name — the
    // same thing the database CHECK enforces.
    expect(PartnerSchema.safeParse({ name: "     " }).success).toBe(false);
  });

  it("accepts exactly 200 characters and rejects 201", () => {
    expect(PartnerSchema.safeParse({ name: "a".repeat(200) }).success).toBe(true);
    expect(PartnerSchema.safeParse({ name: "a".repeat(201) }).success).toBe(false);
  });

  it("measures length after trimming, not before", () => {
    const padded = `  ${"a".repeat(200)}  `;

    expect(PartnerSchema.safeParse({ name: padded }).success).toBe(true);
  });

  it("reports a Vietnamese message for the length rule", () => {
    const parsed = PartnerSchema.safeParse({ name: "a".repeat(201) });

    expect(parsed.error?.issues[0]?.message).toBe("Tên đối tác tối đa 200 ký tự");
  });

  // Round 2 part 3 — optional fields.

  it("accepts a partner with no optional fields", () => {
    const parsed = PartnerSchema.safeParse({ name: "Công ty A" });

    expect(parsed.success).toBe(true);
  });

  it("accepts a partner with address and tax code", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty B",
      address: "Số 9, đường Bắc Hà, Hà Nội",
      taxCode: "0123456789",
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
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an address longer than 500 characters", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty D",
      address: "a".repeat(501),
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Địa chỉ tối đa 500 ký tự");
  });

  it("accepts a tax code with a -NNN branch suffix", () => {
    const parsed = PartnerSchema.safeParse({
      name: "Công ty E",
      taxCode: "0123456789-001",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a tax code that is not 10 digits", () => {
    expect(PartnerSchema.safeParse({ name: "F", taxCode: "123456789" }).success).toBe(false);
    expect(PartnerSchema.safeParse({ name: "F", taxCode: "01234567890" }).success).toBe(false);
  });

  it("rejects a tax code that contains non-digits", () => {
    expect(
      PartnerSchema.safeParse({ name: "F", taxCode: "012345678a" }).success,
    ).toBe(false);
  });

  it("rejects a tax code branch suffix that is not 3 digits", () => {
    expect(
      PartnerSchema.safeParse({ name: "F", taxCode: "0123456789-1" }).success,
    ).toBe(false);
    expect(
      PartnerSchema.safeParse({ name: "F", taxCode: "0123456789-0001" }).success,
    ).toBe(false);
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
});