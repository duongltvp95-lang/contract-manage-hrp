import "server-only";

import { deleteObject } from "@/lib/r2/objects";
import { createAdminClient } from "@/lib/supabase/admin";

export type CleanupReason = "file_deleted" | "upload_db_failed" | "reconciliation";
export type CleanupStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export type CleanupQueueRow = {
  id: string;
  object_key: string;
  reason: CleanupReason;
  status: CleanupStatus;
  attempts: number;
  last_error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

const MAX_BATCH_SIZE = 200;
const DEFAULT_RUN_BUDGET_MS = 48_000;
const DB_TIMEOUT_MS = 3_000;
const R2_TIMEOUT_MS = 4_000;
const RESPONSE_RESERVE_MS = 2_000;
const MIN_JOB_BUDGET_MS = DB_TIMEOUT_MS + R2_TIMEOUT_MS + DB_TIMEOUT_MS + RESPONSE_RESERVE_MS;
const STALE_CLAIM_MS = 5 * 60_000;

type CleanupCandidate = { id: string; object_key: string; attempts: number; created_at: string };
type ClaimResult = { status?: string; object_key?: string };

function requestSignal(deadline: number, reserveMs = RESPONSE_RESERVE_MS): AbortSignal | null {
  const timeoutMs = Math.min(DB_TIMEOUT_MS, deadline - Date.now() - reserveMs);
  return timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value!), min), max);
}

/**
 * Records a cleanup intent under the same per-object advisory lock used by file
 * insertion/deletion and worker claims. The RPC refuses to enqueue keys that
 * are currently referenced by contract_files.
 */
export async function enqueueR2Cleanup(input: {
  objectKey: string;
  reason: Exclude<CleanupReason, "file_deleted">;
  lastError?: string | null;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const signal = AbortSignal.timeout(DB_TIMEOUT_MS);
    const { data, error } = await admin
      .rpc("enqueue_r2_cleanup_if_unreferenced", {
        p_object_key: input.objectKey,
        p_reason: input.reason,
        p_last_error: input.lastError ?? null,
      })
      .abortSignal(signal);

    if (error) {
      console.error("[storage-cleanup:enqueueR2Cleanup] Không thể ghi nhận cleanup intent", error);
      return false;
    }
    return data === true;
  } catch (error) {
    console.error("[storage-cleanup:enqueueR2Cleanup] Lỗi khi ghi nhận cleanup intent", error);
    return false;
  }
}

/**
 * Processes cleanup intents with bounded database and R2 I/O. Each job is
 * claimed under a per-object transaction lock; all reasons are reconciled
 * against contract_files before R2 is touched. Claim leases recover jobs after
 * a serverless invocation is interrupted.
 */
export async function processR2CleanupQueue(options?: {
  limit?: number;
  maxAttempts?: number;
  totalBudgetMs?: number;
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = clampInteger(options?.limit, 20, 1, MAX_BATCH_SIZE);
  const maxAttempts = clampInteger(options?.maxAttempts, 5, 1, 20);
  const totalBudgetMs = clampInteger(options?.totalBudgetMs, DEFAULT_RUN_BUDGET_MS, 5_000, 52_000);
  const deadline = Date.now() + totalBudgetMs;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("[storage-cleanup:process] Không thể khởi tạo admin client", error);
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const candidatesSignal = requestSignal(deadline, MIN_JOB_BUDGET_MS);
  if (!candidatesSignal) return { processed: 0, succeeded: 0, failed: 0 };

  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const [retryResult, staleResult] = await Promise.all([
    admin
      .from("r2_cleanup_queue")
      .select("id, object_key, attempts, created_at")
      .in("status", ["pending", "failed"])
      .lt("attempts", maxAttempts)
      .order("created_at", { ascending: true })
      .limit(limit)
      .abortSignal(candidatesSignal),
    admin
      .from("r2_cleanup_queue")
      .select("id, object_key, attempts, created_at")
      .eq("status", "processing")
      .lt("claimed_at", staleBefore)
      .lt("attempts", maxAttempts)
      .order("created_at", { ascending: true })
      .limit(limit)
      .abortSignal(candidatesSignal),
  ]);

  if (retryResult.error || staleResult.error) {
    console.error("[storage-cleanup:process] Không thể đọc cleanup queue", retryResult.error ?? staleResult.error);
    return { processed: 0, succeeded: 0, failed: 1 };
  }

  const jobs = new Map<string, CleanupCandidate>();
  for (const job of [...(retryResult.data ?? []), ...(staleResult.data ?? [])] as CleanupCandidate[]) {
    jobs.set(job.id, job);
  }
  const candidates = [...jobs.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, limit);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of candidates) {
    if (deadline - Date.now() < MIN_JOB_BUDGET_MS) break;

    try {
      const claimSignal = requestSignal(deadline, R2_TIMEOUT_MS + DB_TIMEOUT_MS + RESPONSE_RESERVE_MS);
      if (!claimSignal) break;
      const { data, error: claimError } = await admin
        .rpc("claim_r2_cleanup_job", {
          p_job_id: job.id,
          p_max_attempts: maxAttempts,
          p_stale_after_seconds: STALE_CLAIM_MS / 1000,
        })
        .abortSignal(claimSignal);

      if (claimError) {
        console.error("[storage-cleanup:process] Không thể claim cleanup job", claimError);
        failed++;
        continue;
      }

      const claim = data as ClaimResult | null;
      if (claim?.status === "cancelled") {
        processed++;
        succeeded++;
        continue;
      }
      if (claim?.status !== "claimed" || !claim.object_key) continue;

      processed++;
      let deleteError: unknown = null;
      const deleteTimeoutMs = Math.min(
        R2_TIMEOUT_MS,
        deadline - Date.now() - DB_TIMEOUT_MS - RESPONSE_RESERVE_MS,
      );

      if (deleteTimeoutMs <= 0) {
        deleteError = new Error("Cleanup run budget exhausted before R2 deletion");
      } else {
        try {
          await deleteObject(claim.object_key, { timeoutMs: deleteTimeoutMs });
        } catch (error) {
          deleteError = error;
        }
      }

      const finishSignal = requestSignal(deadline, 0);
      if (!finishSignal) {
        failed++;
        console.error("[storage-cleanup:process] Hết ngân sách trước khi cập nhật trạng thái job", job.id);
        continue;
      }

      const { data: finished, error: finishError } = await admin
        .rpc("finish_r2_cleanup_job", {
          p_job_id: job.id,
          p_succeeded: deleteError === null,
          p_last_error: deleteError instanceof Error ? deleteError.message : deleteError ? String(deleteError) : null,
        })
        .abortSignal(finishSignal);

      if (finishError || finished !== true) {
        failed++;
        console.error("[storage-cleanup:process] Không thể ghi trạng thái cleanup job", finishError ?? job.id);
      } else if (deleteError) {
        failed++;
      } else {
        succeeded++;
      }
    } catch (error) {
      failed++;
      console.error("[storage-cleanup:process] Lỗi xử lý cleanup job", job.id, error);
    }
  }

  return { processed, succeeded, failed };
}
