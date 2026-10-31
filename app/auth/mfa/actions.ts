"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorized, type ActionResult } from "@/lib/server-action";
import { createClient } from "@/lib/supabase/server";
import { recordCurrentUserAudit } from "@/lib/services/audit-logs";

export type MfaEnrollment = { factorId: string; qrCode: string; secret: string };
export async function beginMfaEnrollmentAction(): Promise<ActionResult<MfaEnrollment>> {
  const access = await authorized();
  if (!access.ok) return access.result;
  const client = await createClient({ abortSignal: AbortSignal.timeout(8_000) });
  const { data: factors, error: listError } = await client.auth.mfa.listFactors();
  if (listError) return { ok: false, code: "db_error", message: "Không thể kiểm tra 2FA. Vui lòng thử lại." };
  if (factors.totp.some((factor) => factor.status === "verified")) {
    return { ok: false, code: "validation", message: "Tài khoản đã có ứng dụng xác thực. Vui lòng nhập mã OTP." };
  }
  for (const factor of factors.all.filter((item) => item.factor_type === "totp" && item.status === "unverified")) {
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return { ok: false, code: "db_error", message: "Không thể khởi động lại thiết lập 2FA." };
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp", friendlyName: "HRP Contract Manager", issuer: "HRP Contract Manager",
  });
  if (error) return { ok: false, code: "db_error", message: "Không thể tạo mã QR. Vui lòng thử lại." };
  return { ok: true, data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

const VerifySchema = z.object({ factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });
export async function verifyMfaAction(input: unknown): Promise<ActionResult<true>> {
  const access = await authorized();
  if (!access.ok) return access.result;
  const parsed = VerifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "validation", message: "Vui lòng nhập mã OTP gồm 6 chữ số." };
  const client = await createClient({ abortSignal: AbortSignal.timeout(8_000) });
  const { error } = await client.auth.mfa.challengeAndVerify(parsed.data);
  if (error) return { ok: false, code: "validation", message: "Mã OTP không đúng hoặc đã hết hạn. Vui lòng thử mã mới." };
  await recordCurrentUserAudit({
    action: "verify_mfa", targetKind: "user", targetId: access.user.id,
    metadata: { factorId: parsed.data.factorId },
  }, { timeoutMs: 2_500 });
  revalidatePath("/", "layout");
  return { ok: true, data: true };
}
