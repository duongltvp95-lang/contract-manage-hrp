"use server";

import { createClient } from "@/lib/supabase/server";
import {
  calculateRemainingAttempts,
  formatRemainingAttemptsMessage,
  LOGIN_ATTEMPTS_COOKIE,
  LOGIN_LOCKOUT_WINDOW_SECONDS,
  MAX_LOGIN_ATTEMPTS,
  parseAttemptsRecord,
  type LoginAttemptsRecord,
} from "@/lib/login-attempts";

export type LoginActionResult =
  | { success: true }
  | { success: false; error: string; remainingAttempts?: number };

/**
 * Đọc an toàn cookie store trong môi trường Next.js Server Action
 * (tránh crash khi chạy trong test runner không có request context).
 */
async function safeGetCookieStore() {
  try {
    const { cookies } = await import("next/headers");
    return await cookies();
  } catch {
    return null;
  }
}

async function getStoredAttempts(email: string): Promise<number> {
  const store = await safeGetCookieStore();
  if (!store) return 0;
  const record = parseAttemptsRecord(store.get(LOGIN_ATTEMPTS_COOKIE)?.value);
  if (!record) return 0;
  if (record.email === email.toLowerCase()) {
    return record.count;
  }
  return 0;
}

async function recordFailedAttempt(email: string): Promise<number> {
  const store = await safeGetCookieStore();
  const current = await getStoredAttempts(email);
  const next = current + 1;

  if (store) {
    const record: LoginAttemptsRecord = {
      email: email.toLowerCase(),
      count: next,
      expiresAt: Date.now() + LOGIN_LOCKOUT_WINDOW_SECONDS * 1000,
    };
    try {
      store.set(LOGIN_ATTEMPTS_COOKIE, JSON.stringify(record), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: LOGIN_LOCKOUT_WINDOW_SECONDS,
      });
    } catch {
      // Bỏ qua nếu môi trường không cho phép ghi cookie
    }
  }

  return next;
}

async function clearStoredAttempts(): Promise<void> {
  const store = await safeGetCookieStore();
  if (store) {
    try {
      store.delete(LOGIN_ATTEMPTS_COOKIE);
    } catch {
      // Bỏ qua nếu môi trường không cho phép xóa cookie
    }
  }
}

/**
 * Server Action đăng nhập cho Next.js App Router.
 *
 * Chạy trên Server để:
 * 1. Đặt Cookie xác thực qua HTTP `Set-Cookie` Header trực tiếp, khắc phục hoàn toàn
 *    vấn đề Safari / iOS WebKit ITP giới hạn hoặc chặn cookie ghi từ client-side `document.cookie`.
 * 2. Theo dõi số lần đăng nhập thất bại và cảnh báo số lần thử còn lại (giới hạn 5 lần).
 * 3. Tự động chuẩn hoá email (trim trailing whitespace do bàn phím iPhone tự gợi ý, lowercase).
 */
export async function loginAction(payload: {
  email: string;
  password: string;
}): Promise<LoginActionResult> {
  const email = (payload.email || "").trim().toLowerCase();
  const password = payload.password || "";

  if (!email || !password) {
    return {
      success: false,
      error: "Vui lòng nhập đầy đủ email và mật khẩu.",
    };
  }

  // 1. Kiểm tra giới hạn số lần thử hiện tại
  const previousAttempts = await getStoredAttempts(email);
  if (previousAttempts >= MAX_LOGIN_ATTEMPTS) {
    return {
      success: false,
      error:
        "Bạn đã nhập sai quá 5 lần. Tài khoản tạm thời bị giới hạn đăng nhập. Vui lòng thử lại sau 15 phút hoặc sử dụng tính năng 'Quên mật khẩu'.",
      remainingAttempts: 0,
    };
  }

  try {
    const supabase = await createClient();
    let { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // Nếu mật khẩu có khoảng trắng đầu/cuối do bàn phím iPhone tự gợi ý và bị lỗi,
    // tự động thử lại một lần với mật khẩu đã trim để hỗ trợ người dùng di động.
    if (error && password.trim() !== password) {
      const retry = await supabase.auth.signInWithPassword({
        email,
        password: password.trim(),
      });
      if (!retry.error) {
        await clearStoredAttempts();
        return { success: true };
      }
      error = retry.error;
    }

    if (error) {
      const msg = error.message.toLowerCase();

      // Kiểm tra Rate Limit từ Supabase
      const isSupabaseRateLimit =
        msg.includes("too many requests") ||
        msg.includes("rate limit") ||
        (typeof (error as { status?: number }).status === "number" &&
          (error as { status?: number }).status === 429);

      if (isSupabaseRateLimit) {
        return {
          success: false,
          error:
            "Bạn đã vượt quá số lần thử đăng nhập cho phép (5 lần). Vui lòng thử lại sau ít phút hoặc sử dụng tính năng 'Quên mật khẩu'.",
          remainingAttempts: 0,
        };
      }

      // Xử lý sai email hoặc mật khẩu -> đếm và cảnh báo số lần còn lại
      if (
        msg.includes("invalid login credentials") ||
        msg.includes("invalid_grant")
      ) {
        const currentFailed = await recordFailedAttempt(email);
        const remaining = calculateRemainingAttempts(currentFailed);

        return {
          success: false,
          error: formatRemainingAttemptsMessage(remaining),
          remainingAttempts: remaining,
        };
      }

      if (msg.includes("email not confirmed")) {
        return {
          success: false,
          error: "Email chưa được kích hoạt hoặc xác thực trong hệ thống.",
        };
      }

      return {
        success: false,
        error: error.message || "Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.",
      };
    }

    // Đăng nhập thành công -> xóa bỏ bộ đếm thất bại
    await clearStoredAttempts();
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Đã xảy ra lỗi kết nối khi đăng nhập.",
    };
  }
}
