/**
 * Login attempts policy & helper — pure logic & formatting.
 * Tracks failed login attempts to warn users and enforce rate limits.
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const MAX_ALTERNATE_ACCOUNTS = 1;
export const LOGIN_ATTEMPTS_COOKIE = "hrp_login_attempts";
export const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 phút

export type LoginAttemptsRecord = {
  email: string;
  count: number;
  expiresAt: number;
};

export type LockoutSessionState = {
  primaryEmail?: string;
  primaryCount?: number;
  lockedEmail?: string;
  lockedUntil?: number;
  alternateEmail?: string;
  alternateCount?: number;
  alternateLockedUntil?: number;
};

export type CheckAllowedResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "PRIMARY_LOCKED" | "ALTERNATE_LOCKED" | "MAX_ALTERNATE_ACCOUNTS_EXCEEDED";
      message: string;
    };

/**
 * Kiểm tra xem một email có được phép thử đăng nhập hay không theo chính sách:
 * - Nếu tài khoản chính bị khóa, chỉ cho phép thử tối đa 1 tài khoản khác duy nhất.
 * - Nếu tài khoản khác cũng bị khóa, cả 2 đều bị chặn cho đến khi hết thời gian khóa.
 */
export function canAttemptLoginWithEmail(
  session: LockoutSessionState,
  emailToAttempt: string,
  now: number = Date.now(),
): CheckAllowedResult {
  const email = emailToAttempt.trim().toLowerCase();

  // 1. Kiểm tra tài khoản chính đang bị khóa
  if (session.lockedEmail && session.lockedEmail.toLowerCase() === email) {
    if (session.lockedUntil && session.lockedUntil > now) {
      return {
        allowed: false,
        reason: "PRIMARY_LOCKED",
        message:
          "Tài khoản này đang bị tạm khóa 15 phút do nhập sai 5 lần. Bạn có thể thử đăng nhập bằng 1 tài khoản khác hoặc đặt lại mật khẩu.",
      };
    }
  }

  // 2. Kiểm tra tài khoản phụ đang bị khóa
  if (session.alternateEmail && session.alternateEmail.toLowerCase() === email) {
    if (session.alternateLockedUntil && session.alternateLockedUntil > now) {
      return {
        allowed: false,
        reason: "ALTERNATE_LOCKED",
        message:
          "Tài khoản khác này cũng đã bị tạm khóa 15 phút do nhập sai 5 lần. Vui lòng thử lại sau hoặc đặt lại mật khẩu.",
      };
    }
  }

  // 3. Nếu tài khoản chính đang bị khóa, chỉ cho phép thử 1 tài khoản khác duy nhất
  if (session.lockedEmail && session.lockedUntil && session.lockedUntil > now) {
    if (session.lockedEmail.toLowerCase() !== email) {
      if (
        session.alternateEmail &&
        session.alternateEmail.toLowerCase() !== email
      ) {
        return {
          allowed: false,
          reason: "MAX_ALTERNATE_ACCOUNTS_EXCEEDED",
          message: `Hệ thống chỉ cho phép thử tối đa 1 tài khoản khác (${session.alternateEmail}) trong thời gian tài khoản ban đầu bị khóa. Bạn không thể thử tài khoản ${email}.`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Tạo thông điệp cảnh báo số lần thử đăng nhập còn lại bằng tiếng Việt rõ ràng.
 */
export function formatRemainingAttemptsMessage(
  remaining: number,
  isAlternate: boolean = false,
): string {
  const accountPrefix = isAlternate ? " với tài khoản này" : "";
  if (remaining <= 0) {
    return isAlternate
      ? "Bạn đã nhập sai 5 lần với tài khoản khác này. Nút đăng nhập đã bị khóa trong 15 phút."
      : "Bạn đã nhập sai quá 5 lần. Tài khoản tạm thời bị giới hạn đăng nhập. Vui lòng thử lại sau 15 phút hoặc sử dụng tính năng 'Quên mật khẩu'.";
  }
  if (remaining === 1) {
    return `Email hoặc mật khẩu không chính xác. Bạn chỉ còn 1 lần thử cuối cùng${accountPrefix} trước khi tài khoản bị tạm khóa!`;
  }
  return `Email hoặc mật khẩu không chính xác. Bạn còn ${remaining} lần thử${accountPrefix} trước khi tài khoản bị tạm khóa.`;
}

/**
 * Parse an toàn dữ liệu số lần thử từ cookie chuỗi (tương thích backward).
 */
export function parseAttemptsRecord(
  raw?: string | null,
  now: number = Date.now(),
): LoginAttemptsRecord | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (
      typeof data.count === "number" &&
      typeof data.expiresAt === "number" &&
      typeof data.email === "string"
    ) {
      if (data.expiresAt < now) return null;
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse an toàn trạng thái phiên khóa nhiều tài khoản từ cookie hoặc localStorage.
 */
export function parseLockoutSession(
  raw?: string | null,
  now: number = Date.now(),
): LockoutSessionState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;

    const session: LockoutSessionState = {};
    if (typeof data.primaryEmail === "string") {
      session.primaryEmail = data.primaryEmail;
      session.primaryCount = typeof data.primaryCount === "number" ? data.primaryCount : 0;
    }
    if (typeof data.lockedEmail === "string" && typeof data.lockedUntil === "number") {
      if (data.lockedUntil > now) {
        session.lockedEmail = data.lockedEmail;
        session.lockedUntil = data.lockedUntil;
      }
    }
    if (typeof data.alternateEmail === "string") {
      session.alternateEmail = data.alternateEmail;
      session.alternateCount = typeof data.alternateCount === "number" ? data.alternateCount : 0;
      if (typeof data.alternateLockedUntil === "number" && data.alternateLockedUntil > now) {
        session.alternateLockedUntil = data.alternateLockedUntil;
      }
    }

    if (!session.lockedEmail && !session.alternateEmail && !session.primaryEmail) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Tính số lần thử còn lại dựa trên số lần đã thử hiện tại.
 */
export function calculateRemainingAttempts(
  currentAttempts: number,
  maxAttempts: number = MAX_LOGIN_ATTEMPTS,
): number {
  return Math.max(0, maxAttempts - currentAttempts);
}
