/**
 * Login attempts policy & helper — pure logic & formatting.
 * Tracks failed login attempts to warn users and enforce rate limits.
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPTS_COOKIE = "hrp_login_attempts";
export const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 phút

export type LoginAttemptsRecord = {
  email: string;
  count: number;
  expiresAt: number;
};

/**
 * Tạo thông điệp cảnh báo số lần thử đăng nhập còn lại bằng tiếng Việt rõ ràng.
 */
export function formatRemainingAttemptsMessage(remaining: number): string {
  if (remaining <= 0) {
    return "Bạn đã nhập sai quá 5 lần. Tài khoản tạm thời bị giới hạn đăng nhập. Vui lòng thử lại sau 15 phút hoặc sử dụng tính năng 'Quên mật khẩu'.";
  }
  if (remaining === 1) {
    return "Email hoặc mật khẩu không chính xác. Bạn chỉ còn 1 lần thử cuối cùng trước khi tài khoản bị tạm khóa!";
  }
  return `Email hoặc mật khẩu không chính xác. Bạn còn ${remaining} lần thử trước khi tài khoản bị tạm khóa.`;
}

/**
 * Parse an toàn dữ liệu số lần thử từ cookie chuỗi.
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
 * Tính số lần thử còn lại dựa trên số lần đã thử hiện tại.
 */
export function calculateRemainingAttempts(
  currentAttempts: number,
  maxAttempts: number = MAX_LOGIN_ATTEMPTS,
): number {
  return Math.max(0, maxAttempts - currentAttempts);
}
