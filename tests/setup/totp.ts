import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** RFC 6238, used only with dedicated test accounts. Never log the shared secret. */
export function testTotp(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/[=\s]/g, "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid test TOTP secret");
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
  }
  if (bytes.length < 10) throw new Error("Test TOTP secret is too short");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function elevateTestAdmin(client: SupabaseClient, fixedAdmin: boolean): Promise<void> {
  const { data: factors, error } = await client.auth.mfa.listFactors();
  if (error) throw new Error("Cannot inspect test MFA factors");
  let factorId = factors.totp.find((item) => item.status === "verified")?.id;
  let secret = process.env.TEST_ADMIN_TOTP_SECRET ?? "";
  if (!factorId) {
    if (fixedAdmin) throw new Error("Enroll the dedicated TEST_ADMIN account in TOTP and configure TEST_ADMIN_TOTP_SECRET first.");
    const enrollment = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Temporary HRP test" });
    if (enrollment.error) throw new Error("Cannot enroll temporary test administrator MFA");
    factorId = enrollment.data.id;
    secret = enrollment.data.totp.secret;
  }
  const verification = await client.auth.mfa.challengeAndVerify({ factorId, code: testTotp(secret) });
  if (verification.error) throw new Error("Test administrator MFA failed; check the dedicated test secret and clock.");
}
