import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { dbError, err, ok } from "@/lib/services/types";

/** Only enrollment/verification and ordinary account access are allowed at AAL1. */
export const requireMfa = cache(async () => {
  try {
    const client = await createClient({ abortSignal: AbortSignal.timeout(5_000) });
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return dbError("requireMfa", error);
    return data?.currentLevel === "aal2" ? ok(true as const)
      : err("mfa_required", "Vui lòng mở Bảo mật 2FA trong Cài đặt và xác thực mã OTP trước khi thực hiện thao tác này.");
  } catch (error) { return dbError("requireMfa", error); }
});

export type MfaState = {
  verified: boolean;
  factors: { id: string; name: string }[];
};

export async function readMfaState() {
  const client = await createClient({ abortSignal: AbortSignal.timeout(5_000) });
  const [assurance, factors] = await Promise.all([
    client.auth.mfa.getAuthenticatorAssuranceLevel(), client.auth.mfa.listFactors(),
  ]);
  if (assurance.error || factors.error) return dbError("readMfaState", assurance.error || factors.error);
  return ok<MfaState>({
    verified: assurance.data?.currentLevel === "aal2",
    factors: (factors.data?.totp ?? []).filter((factor) => factor.status === "verified")
      .map((factor) => ({ id: factor.id, name: factor.friendly_name || "Ứng dụng xác thực" })),
  });
}
