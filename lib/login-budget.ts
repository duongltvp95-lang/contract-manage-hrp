import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

function subjectKey(email: string): string {
  const secret = process.env.LOGIN_RATE_LIMIT_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Login rate-limit secret is not configured");
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

export type LoginBudget = { allowed: boolean; remaining: number; expires_at: string };

export async function claimLoginAttempt(email: string): Promise<LoginBudget> {
  const { data, error } = await createAdminClient()
    .rpc("claim_login_attempt", { p_subject_key: subjectKey(email) })
    .abortSignal(AbortSignal.timeout(3_000));
  if (error || !data || typeof data.allowed !== "boolean" || !Number.isFinite(data.remaining)) {
    throw new Error("Login counter unavailable", { cause: error });
  }
  return data as LoginBudget;
}

export async function clearLoginAttempts(email: string): Promise<void> {
  const { error } = await createAdminClient()
    .rpc("clear_login_attempts", { p_subject_key: subjectKey(email) })
    .abortSignal(AbortSignal.timeout(3_000));
  if (error) console.error("[login:clear-budget]", error.code);
}
