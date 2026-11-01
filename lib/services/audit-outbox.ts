import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuditRetryResult = { processed: number; succeeded: number; failed: number; exhausted: number };
export async function processAuditOutbox(): Promise<AuditRetryResult> {
  const { data, error } = await createAdminClient()
    .rpc("process_audit_event_outbox", { p_limit: 100, p_max_attempts: 8 })
    .abortSignal(AbortSignal.timeout(4_000));
  if (error || !data || ![data.processed, data.succeeded, data.failed, data.exhausted]
    .every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Audit retry worker unavailable", { cause: error });
  }
  if (data.failed || data.exhausted) console.error("[audit:retry]", { failed: data.failed, exhausted: data.exhausted });
  return data as AuditRetryResult;
}
