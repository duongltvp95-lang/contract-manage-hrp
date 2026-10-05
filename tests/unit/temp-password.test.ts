import { describe, expect, it } from "vitest";

import { generateTemporaryPassword } from "@/lib/temp-password";

/**
 * Feature round 2, part 3 — the one-time password handed to an administrator.
 *
 * It is a live credential for a real account, so the properties worth pinning
 * down are: it is long, it mixes character classes (so any future password
 * policy accepts it), it is unpredictable, and it survives copy/paste
 * unharmed.
 */

describe("generateTemporaryPassword", () => {
  it("is long enough to be worth something", () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(16);
  });

  it("always contains lower case, upper case, a digit and a symbol", () => {
    // Run it a number of times: the random part must never be the reason a
    // password policy rejects the value.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const password = generateTemporaryPassword();

      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("uses only characters that survive copy, paste and JSON", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateTemporaryPassword()).toMatch(/^[A-Za-z0-9_-]+[aA1!]$/);
    }
  });

  it("is different every time", () => {
    const generated = new Set(
      Array.from({ length: 200 }, () => generateTemporaryPassword()),
    );

    // 200 draws from 18 random bytes; a collision would mean the entropy is not
    // what this claims.
    expect(generated.size).toBe(200);
  });
});
