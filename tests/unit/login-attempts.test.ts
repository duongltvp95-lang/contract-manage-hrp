import { describe, expect, it } from "vitest";
import {
  calculateRemainingAttempts,
  formatRemainingAttemptsMessage,
  MAX_LOGIN_ATTEMPTS,
  parseAttemptsRecord,
} from "@/lib/login-attempts";

describe("login-attempts policy & formatting", () => {
  it("enforces MAX_LOGIN_ATTEMPTS = 5", () => {
    expect(MAX_LOGIN_ATTEMPTS).toBe(5);
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
});
