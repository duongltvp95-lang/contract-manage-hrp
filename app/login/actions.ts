"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Server Action đăng nhập cho Next.js App Router.
 *
 * Chạy trên Server để:
 * 1. Đặt Cookie xác thực qua HTTP `Set-Cookie` Header trực tiếp, khắc phục hoàn toàn
 *    vấn đề Safari / iOS WebKit ITP giới hạn hoặc chặn cookie ghi từ client-side `document.cookie`.
 * 2. Tránh race condition khi điều hướng trên Safari iPhone (WebKit delay flush cookie).
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
        return { success: true };
      }
      error = retry.error;
    }

    if (error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("invalid login credentials") ||
        msg.includes("invalid_grant")
      ) {
        return {
          success: false,
          error: "Email hoặc mật khẩu không chính xác.",
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
