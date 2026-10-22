"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { recordAudit, recordLogoutAudit } from "@/lib/services/audit-logs";
import {
  calculateRemainingAttempts,
  canAttemptLoginWithEmail,
  formatRemainingAttemptsMessage,
  LOGIN_ATTEMPTS_COOKIE,
  LOGIN_LOCKOUT_WINDOW_SECONDS,
  parseLockoutSession,
  type LockoutSessionState,
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

async function getStoredLockoutSession(): Promise<LockoutSessionState> {
  const store = await safeGetCookieStore();
  if (!store) return {};
  const raw = store.get(LOGIN_ATTEMPTS_COOKIE)?.value;
  return parseLockoutSession(raw) || {};
}

async function saveStoredLockoutSession(session: LockoutSessionState): Promise<void> {
  const store = await safeGetCookieStore();
  if (!store) return;
  try {
    store.set(LOGIN_ATTEMPTS_COOKIE, JSON.stringify(session), {
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

async function recordFailedAttemptSession(
  email: string,
): Promise<{ remaining: number; isAlternate: boolean; session: LockoutSessionState }> {
  const session = await getStoredLockoutSession();
  const lowerEmail = email.toLowerCase();
  const now = Date.now();

  // Kiểm tra xem đây có phải là tài khoản phụ (alternate) khi tài khoản chính đang bị khóa không
  const isAlternate = Boolean(
    session.lockedEmail &&
    session.lockedUntil &&
    session.lockedUntil > now &&
    session.lockedEmail.toLowerCase() !== lowerEmail,
  );

  if (isAlternate) {
    session.alternateEmail = lowerEmail;
    const nextAlt = (session.alternateCount || 0) + 1;
    session.alternateCount = nextAlt;
    const remaining = calculateRemainingAttempts(nextAlt);
    if (remaining <= 0) {
      session.alternateLockedUntil = now + LOGIN_LOCKOUT_WINDOW_SECONDS * 1000;
    }
    await saveStoredLockoutSession(session);
    return { remaining, isAlternate: true, session };
  }

  // Đây là tài khoản chính
  const isSamePrimary = session.primaryEmail?.toLowerCase() === lowerEmail;
  const nextCount = isSamePrimary ? (session.primaryCount || 0) + 1 : 1;
  session.primaryEmail = lowerEmail;
  session.primaryCount = nextCount;
  const remaining = calculateRemainingAttempts(nextCount);
  if (remaining <= 0) {
    session.lockedEmail = lowerEmail;
    session.lockedUntil = now + LOGIN_LOCKOUT_WINDOW_SECONDS * 1000;
  }
  await saveStoredLockoutSession(session);
  return { remaining, isAlternate: false, session };
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
 * 3. Hỗ trợ chính sách: nếu 1 tài khoản bị khóa, chỉ cho phép thử tối đa 1 tài khoản khác.
 * 4. Tự động chuẩn hoá email (trim trailing whitespace do bàn phím iPhone tự gợi ý, lowercase).
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

  // 1. Kiểm tra chính sách giới hạn phiên (nếu tài khoản chính bị khóa, chỉ cho phép thử 1 tài khoản khác)
  const session = await getStoredLockoutSession();
  const allowedCheck = canAttemptLoginWithEmail(session, email);
  if (!allowedCheck.allowed) {
    return {
      success: false,
      error: allowedCheck.message,
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
            "Bạn đã vượt quá số lần thử đăng nhập cho phép (5 lần). Vui lòng thử lại sau 15 phút hoặc sử dụng tính năng 'Quên mật khẩu'.",
          remainingAttempts: 0,
        };
      }

      // Xử lý sai email hoặc mật khẩu -> đếm và cảnh báo số lần còn lại
      const errCode = (error as { code?: string }).code;
      const isInvalidCredentials =
        errCode === "invalid_credentials" ||
        errCode === "invalid_grant" ||
        msg.includes("invalid") ||
        msg.includes("credentials") ||
        msg.includes("grant") ||
        msg.includes("password") ||
        msg.includes("user not found") ||
        (typeof (error as { status?: number }).status === "number" &&
          (error as { status?: number }).status === 400);

      if (isInvalidCredentials) {
        const { remaining, isAlternate } = await recordFailedAttemptSession(email);
        return {
          success: false,
          error: formatRemainingAttemptsMessage(remaining, isAlternate),
          remainingAttempts: remaining,
        };
      }

      if (msg.includes("email not confirmed")) {
        return {
          success: false,
          error: "Email chưa được kích hoạt hoặc xác thực trong hệ thống.",
        };
      }

      // Đối với các lỗi khác, vẫn tính là 1 lần thử sai nếu trạng thái là 4xx
      const { remaining, isAlternate } = await recordFailedAttemptSession(email);
      return {
        success: false,
        error: error.message
          ? `${error.message}. Bạn còn ${remaining} lần thử.`
          : formatRemainingAttemptsMessage(remaining, isAlternate),
        remainingAttempts: remaining,
      };
    }

    // Đăng nhập thành công -> xóa bỏ bộ đếm thất bại
    await clearStoredAttempts();

    // Ghi nhận nhật ký đăng nhập sử dụng của tài khoản
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        const adminClient = createAdminClient();
        const { data: profile } = await adminClient
          .from("profiles")
          .select("organization_id, role")
          .eq("id", authData.user.id)
          .maybeSingle();

        if (profile) {
          await recordAudit({
            organizationId: profile.organization_id,
            actorId: authData.user.id,
            actorRole: profile.role === "admin" ? "admin" : "user",
            action: "login",
            targetKind: "user",
            targetId: authData.user.id,
            metadata: {
              email: authData.user.email ?? email,
            },
          });
        }
      }
    } catch (auditErr) {
      console.error("[login:audit]", auditErr);
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

/** Server Action ghi nhận sự kiện Đăng xuất vào nhật ký sử dụng */
export async function recordLogoutAction(): Promise<void> {
  try {
    await recordLogoutAudit();
  } catch (err) {
    console.error("[logout:audit]", err);
  }
}
