import { describe, expect, it } from "vitest";
import {
  calculateRemainingAttempts,
  canAttemptLoginWithEmail,
  formatRemainingAttemptsMessage,
  MAX_ALTERNATE_ACCOUNTS,
  MAX_LOGIN_ATTEMPTS,
  parseAttemptsRecord,
  parseLockoutSession,
} from "@/lib/login-attempts";

describe("login-attempts policy & formatting", () => {
  it("enforces MAX_LOGIN_ATTEMPTS = 5 and MAX_ALTERNATE_ACCOUNTS = 1", () => {
    expect(MAX_LOGIN_ATTEMPTS).toBe(5);
    expect(MAX_ALTERNATE_ACCOUNTS).toBe(1);
  });

  it("calculates remaining attempts correctly", () => {
    expect(calculateRemainingAttempts(0)).toBe(5);
    expect(calculateRemainingAttempts(1)).toBe(4);
    expect(calculateRemainingAttempts(2)).toBe(3);
    expect(calculateRemainingAttempts(3)).toBe(2);
    expect(calculateRemainingAttempts(4)).toBe(1);
    expect(calculateRemainingAttempts(5)).toBe(0);
    expect(calculateRemainingAttempts(6)).toBe(0);
  });

  it("formats remaining attempts message with clear Vietnamese text", () => {
    expect(formatRemainingAttemptsMessage(4)).toContain("Bạn còn 4 lần thử trước khi tài khoản bị tạm khóa");
    expect(formatRemainingAttemptsMessage(3)).toContain("Bạn còn 3 lần thử");
    expect(formatRemainingAttemptsMessage(2)).toContain("Bạn còn 2 lần thử");
    expect(formatRemainingAttemptsMessage(1)).toContain("Bạn chỉ còn 1 lần thử cuối cùng");
    expect(formatRemainingAttemptsMessage(0)).toContain("Bạn đã nhập sai quá 5 lần");
    expect(formatRemainingAttemptsMessage(-1)).toContain("Bạn đã nhập sai quá 5 lần");
    expect(formatRemainingAttemptsMessage(2, true)).toContain("với tài khoản này");
  });

  it("parses valid attempt cookie records safely", () => {
    const future = Date.now() + 60000;
    const raw = JSON.stringify({ email: "test@hrpartner.vn", count: 2, expiresAt: future });
    const parsed = parseAttemptsRecord(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.count).toBe(2);
    expect(parsed?.email).toBe("test@hrpartner.vn");
  });

  it("rejects expired or malformed records", () => {
    const past = Date.now() - 1000;
    const expiredRaw = JSON.stringify({ email: "test@hrpartner.vn", count: 2, expiresAt: past });
    expect(parseAttemptsRecord(expiredRaw)).toBeNull();
    expect(parseAttemptsRecord("")).toBeNull();
    expect(parseAttemptsRecord(null)).toBeNull();
    expect(parseAttemptsRecord("invalid json")).toBeNull();
    expect(parseAttemptsRecord(JSON.stringify({ count: "not a number" }))).toBeNull();
  });

  describe("alternate account policy (canAttemptLoginWithEmail)", () => {
    const now = 1000000;
    const future = now + 900000; // +15 mins

    it("allows any email when no lockout exists", () => {
      const result = canAttemptLoginWithEmail({}, "admin@hrp.vn", now);
      expect(result.allowed).toBe(true);
    });

    it("blocks primary email when it is currently locked", () => {
      const session = {
        lockedEmail: "admin@hrp.vn",
        lockedUntil: future,
      };
      const result = canAttemptLoginWithEmail(session, "admin@hrp.vn", now);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("PRIMARY_LOCKED");
        expect(result.message).toContain("Tài khoản này đang bị tạm khóa 15 phút");
      }
    });

    it("allows trying a 1st alternate email when primary is locked", () => {
      const session = {
        lockedEmail: "admin@hrp.vn",
        lockedUntil: future,
      };
      const result = canAttemptLoginWithEmail(session, "manager@hrp.vn", now);
      expect(result.allowed).toBe(true);
    });

    it("allows retrying the SAME alternate email that was previously registered", () => {
      const session = {
        lockedEmail: "admin@hrp.vn",
        lockedUntil: future,
        alternateEmail: "manager@hrp.vn",
        alternateCount: 2,
      };
      const result = canAttemptLoginWithEmail(session, "manager@hrp.vn", now);
      expect(result.allowed).toBe(true);
    });

    it("BLOCKS attempting a 2nd alternate email (condition: chỉ được thử với 1 tài khoản khác)", () => {
      const session = {
        lockedEmail: "admin@hrp.vn",
        lockedUntil: future,
        alternateEmail: "manager@hrp.vn",
        alternateCount: 1,
      };
      const result = canAttemptLoginWithEmail(session, "third-user@hrp.vn", now);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("MAX_ALTERNATE_ACCOUNTS_EXCEEDED");
        expect(result.message).toContain("Hệ thống chỉ cho phép thử tối đa 1 tài khoản khác (manager@hrp.vn)");
      }
    });

    it("blocks alternate email when alternate email itself is locked", () => {
      const session = {
        lockedEmail: "admin@hrp.vn",
        lockedUntil: future,
        alternateEmail: "manager@hrp.vn",
        alternateCount: 5,
        alternateLockedUntil: future,
      };
      const result = canAttemptLoginWithEmail(session, "manager@hrp.vn", now);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("ALTERNATE_LOCKED");
        expect(result.message).toContain("Tài khoản khác này cũng đã bị tạm khóa");
      }
    });

    it("allows login again after lockout time has expired", () => {
      const past = now - 1000;
      const session = {
        lockedEmail: "admin@hrp.vn",
        lockedUntil: past,
      };
      const result = canAttemptLoginWithEmail(session, "admin@hrp.vn", now);
      expect(result.allowed).toBe(true);
    });
  });

  describe("parseLockoutSession", () => {
    it("parses valid lockout session", () => {
      const future = Date.now() + 60000;
      const raw = JSON.stringify({
        lockedEmail: "admin@hrp.vn",
        lockedUntil: future,
        alternateEmail: "alt@hrp.vn",
        alternateCount: 2,
      });
      const parsed = parseLockoutSession(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.lockedEmail).toBe("admin@hrp.vn");
      expect(parsed?.alternateEmail).toBe("alt@hrp.vn");
      expect(parsed?.alternateCount).toBe(2);
    });

    it("rejects invalid or expired session", () => {
      expect(parseLockoutSession("")).toBeNull();
      expect(parseLockoutSession(null)).toBeNull();
      expect(parseLockoutSession("invalid")).toBeNull();
      const past = Date.now() - 1000;
      const expiredRaw = JSON.stringify({
        lockedEmail: "admin@hrp.vn",
        lockedUntil: past,
      });
      expect(parseLockoutSession(expiredRaw)).toBeNull();
    });
  });
});
