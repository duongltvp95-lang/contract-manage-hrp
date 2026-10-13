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
    expect(isOwnerUserId("11111111-1111-1111-1111-111111111111")).toBe(false);
    expect(isOwnerUserId(null)).toBe(false);
    expect(isOwnerUserId(undefined)).toBe(false);
  });

  it("authorizes only Owner to reset passwords", () => {
    const isAllowedToReset = (userId?: string | null, email?: string | null) =>
      isOwnerUserId(userId) || isOwnerEmail(email);

    // Owner is allowed
    expect(isAllowedToReset(OWNER_USER_ID, OWNER_EMAIL)).toBe(true);
    expect(isAllowedToReset(OWNER_USER_ID, null)).toBe(true);
    expect(isAllowedToReset(null, "duongltvp95@gmail.com")).toBe(true);
    expect(isAllowedToReset(null, "DUONGLTVP95@GMAIL.COM")).toBe(true);

    // Other admins or regular users are NOT allowed
    expect(isAllowedToReset("3d969068-5c75-4428-99ee-a9e85ce3df7e", "admin2@hrpartner.test")).toBe(false);
    expect(isAllowedToReset("775bb049-c267-4ec2-b857-3fdbc8eb8015", "user@hrpartner.test")).toBe(false);
    expect(isAllowedToReset(null, null)).toBe(false);
  });
});
