import { describe, expect, it } from "vitest";

import { UpdateProfileSchema } from "@schemas/profile";

/**
 * W1-WEB-034 — the one editable profile field (plan section 71).
 */

describe("UpdateProfileSchema", () => {
  it("accepts a normal name", () => {
    expect(UpdateProfileSchema.safeParse({ fullName: "Dương Lê" }).success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(UpdateProfileSchema.parse({ fullName: "  Dương Lê  " }).fullName).toBe(
      "Dương Lê",
    );
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(UpdateProfileSchema.safeParse({ fullName: "" }).success).toBe(false);
    expect(UpdateProfileSchema.safeParse({ fullName: "   " }).success).toBe(false);
    expect(UpdateProfileSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a name longer than 100 characters", () => {
    expect(
      UpdateProfileSchema.safeParse({ fullName: "x".repeat(100) }).success,
    ).toBe(true);
    expect(
      UpdateProfileSchema.safeParse({ fullName: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("strips a role or organization the client tries to escalate with", () => {
    // The database grants UPDATE on `full_name` only; this proves the schema
    // would not even forward anything else.
    const parsed = UpdateProfileSchema.parse({
      fullName: "Dương Lê",
      role: "admin",
      organizationId: "22222222-2222-2222-2222-222222222222",
    });
    expect(parsed).toEqual({ fullName: "Dương Lê" });
  });
});
