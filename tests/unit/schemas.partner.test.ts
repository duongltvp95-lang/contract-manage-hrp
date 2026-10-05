import { describe, expect, it } from "vitest";

import { PartnerSchema, UpdatePartnerSchema } from "@schemas/partner";

/**
 * Feature round 2, part 1 — shared partner validation.
 *
 * The same schema backs the form and the service, so these assertions are the
 * contract between the two. The rules mirror the database CHECK constraint:
 * 1-200 characters after trimming.
 */

describe("PartnerSchema", () => {
  it("accepts a normal name", () => {
    const parsed = PartnerSchema.safeParse({ name: "Công ty TNHH Samsung Electronics Việt Nam" });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Công ty TNHH Samsung Electronics Việt Nam");
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
});
