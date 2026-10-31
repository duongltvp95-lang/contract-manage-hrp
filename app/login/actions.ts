"use server";

import { claimLoginAttempt, clearLoginAttempts } from "@/lib/login-budget";
import { z } from "zod";
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
  | { success: true; mfaRequired?: boolean }
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
const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(1024),
});

export async function loginAction(payload: {
  email: string; password: string;
}): Promise<LoginActionResult> {
  const parsed = LoginSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "Vui lòng nhập đầy đủ email và mật khẩu hợp lệ." };
  const { email, password } = parsed.data;
  const session = await getStoredLockoutSession();
  const local = canAttemptLoginWithEmail(session, email);
  if (!local.allowed) return { success: false, error: local.message, remainingAttempts: 0 };

  try {
    let budget = await claimLoginAttempt(email);
    const lockedResult = async (): Promise<LoginActionResult> => {
      await saveStoredLockoutSession({
        ...session, primaryEmail: email, primaryCount: 5,
        lockedEmail: email, lockedUntil: Date.parse(budget.expires_at),
      });
      return { success: false, remainingAttempts: 0,
        error: "Tài khoản này đã hết lượt thử đăng nhập. Vui lòng thử lại sau 15 phút." };
    };
    if (!budget.allowed) return lockedResult();
    const supabase = await createClient({ abortSignal: AbortSignal.timeout(8_000) });
    let { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error && password.trim() && password.trim() !== password) {
      budget = await claimLoginAttempt(email);
      if (!budget.allowed) return lockedResult();
      const retry = await supabase.auth.signInWithPassword({ email, password: password.trim() });
      error = retry.error;
    }
    if (error) {
      const rateLimited = error.status === 429;
      if (rateLimited) return {
        success: false, remainingAttempts: 0,
        error: "Bạn đã gửi quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau.",
      };
      const failed = await recordFailedAttemptSession(email);
      const remaining = Math.min(failed.remaining, budget.remaining);
      if (remaining === 0) {
        await saveStoredLockoutSession({
          ...failed.session, lockedEmail: email, lockedUntil: Date.parse(budget.expires_at),
        });
      }
      return { success: false, remainingAttempts: remaining,
        error: formatRemainingAttemptsMessage(remaining, failed.isAlternate) };
    }

    // Every successful path, including the trimmed-password retry, reaches audit.
    const { data: authData, error: userError } = await supabase.auth.getUser();
    if (userError || !authData.user) return { success: false, error: "Không thể xác nhận phiên đăng nhập." };
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("organization_id, role, is_active").eq("id", authData.user.id).maybeSingle();
    if (profileError || !profile || !profile.is_active) {
      await supabase.auth.signOut();
      return { success: false, error: profileError ? "Không thể kiểm tra quyền truy cập. Vui lòng thử lại." : "Tài khoản đã bị vô hiệu hoá." };
    }
    await clearStoredAttempts();
    await clearLoginAttempts(email);
    const audit = await recordAudit({
      organizationId: profile.organization_id, actorId: authData.user.id,
      actorRole: profile.role === "admin" ? "admin" : "user",
      action: "login", targetKind: "user", targetId: authData.user.id,
      metadata: { email: authData.user.email ?? email },
    }, { timeoutMs: 2_500 });
    if (!audit.ok) console.error("[login:audit]", audit.code);
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) {
      await supabase.auth.signOut();
      return { success: false, error: "Không thể kiểm tra xác thực hai bước. Vui lòng thử lại." };
    }
    return { success: true, mfaRequired: profile.role === "admin" || assurance?.nextLevel === "aal2" };
  } catch (error) {
    console.error("[login]", error instanceof Error ? error.message : "unavailable");
    return { success: false, error: "Dịch vụ đăng nhập tạm thời không khả dụng. Vui lòng thử lại sau." };
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
