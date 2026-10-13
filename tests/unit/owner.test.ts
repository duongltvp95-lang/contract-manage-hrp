import { describe, expect, it } from "vitest";
import { isOwnerEmail, isOwnerUserId, OWNER_EMAIL, OWNER_USER_ID } from "@/lib/owner";

describe("Owner Protection Rules", () => {
  it("identifies the protected owner email in any case and with whitespace", () => {
    expect(isOwnerEmail("duongltvp95@gmail.com")).toBe(true);
    expect(isOwnerEmail("  duongltvp95@gmail.com  ")).toBe(true);
    expect(isOwnerEmail("DUONGLTVP95@GMAIL.COM")).toBe(true);
    expect(isOwnerEmail(OWNER_EMAIL)).toBe(true);

    expect(isOwnerEmail("other@gmail.com")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
    expect(isOwnerEmail("")).toBe(false);
  });

  it("identifies the protected owner user ID", () => {
    expect(isOwnerUserId("495eb514-82d9-4969-a610-760947a0a79d")).toBe(true);
    expect(isOwnerUserId("  495eb514-82d9-4969-a610-760947a0a79d  ")).toBe(true);
    expect(isOwnerUserId(OWNER_USER_ID)).toBe(true);

    expect(isOwnerUserId("11111111-1111-1111-1111-111111111111")).toBe(false);
    expect(isOwnerUserId(null)).toBe(false);
    expect(isOwnerUserId(undefined)).toBe(false);
  });
});
