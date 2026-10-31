import { describe, expect, it } from "vitest";
import { testTotp } from "../setup/totp";
describe("test-account TOTP", () => {
  it("matches RFC 6238 SHA1 test vectors using six digits", () => {
    const key = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(testTotp(key, 59_000)).toBe("287082");
    expect(testTotp(key, 1_111_111_109_000)).toBe("081804");
  });
  it("rejects invalid or missing test secrets", () => {
    expect(() => testTotp("not-a-base32-key")).toThrow();
    expect(() => testTotp("")).toThrow();
  });
});
