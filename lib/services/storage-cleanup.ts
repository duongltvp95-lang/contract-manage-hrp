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
  created_at: string;
  updated_at: string;
};

/**
 * Enqueues an R2 object key into the durable cleanup outbox table.
 *
 * Called when:
 * 1. A file was deleted from the database, but immediate R2 deletion failed.
 * 2. An upload DB insert failed (and row is confirmed not committed), but immediate compensating delete failed.
 *
 * Errors during enqueue are logged but never thrown, ensuring the primary user flow is not interrupted.
 */
export async function enqueueR2Cleanup(input: {
  objectKey: string;
  reason: CleanupReason;
  lastError?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("r2_cleanup_queue").insert({
      object_key: input.objectKey,
      reason: input.reason,
      status: "pending",
      last_error: input.lastError ?? null,
      attempts: 0,
    });
  } catch (error) {
    console.error("[storage-cleanup:enqueueR2Cleanup] Không thể ghi nhận tác vụ cleanup", error);
  }
}

/**
 * Processes pending items from the R2 cleanup outbox queue.
 *
 * Reconciles with the database before deleting:
 * For `upload_db_failed`, if an active `contract_files` row is found referencing the key,
 * the task is cancelled rather than deleting a valid in-use file.
 */
export async function processR2CleanupQueue(options?: {
  limit?: number;
  maxAttempts?: number;
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = options?.limit ?? 20;
  const maxAttempts = options?.maxAttempts ?? 5;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("[storage-cleanup:process] Không thể khởi tạo admin client", err);
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const { data: jobs, error } = await admin
    .from("r2_cleanup_queue")
    .select("id, object_key, reason, attempts, status")
    .in("status", ["pending", "failed"])
    .lt("attempts", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !jobs || jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs as { id: string; object_key: string; reason: CleanupReason; attempts: number }[]) {
    // For upload_db_failed, verify the file isn't referenced by any active contract_files row
    if (job.reason === "upload_db_failed") {
      const { data: existingRow } = await admin
        .from("contract_files")
        .select("id")
        .eq("object_key", job.object_key)
        .maybeSingle();

      if (existingRow) {
        await admin
          .from("r2_cleanup_queue")
          .update({
            status: "cancelled",
            last_error: "Object is referenced by active contract file",
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        succeeded++;
        continue;
      }
    }

    try {
      await deleteObject(job.object_key);
      await admin
        .from("r2_cleanup_queue")
        .update({
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      succeeded++;
    } catch (delError) {
      failed++;
      const errorMessage = delError instanceof Error ? delError.message : String(delError);
      await admin
        .from("r2_cleanup_queue")
        .update({
          status: "failed",
          attempts: job.attempts + 1,
          last_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
  }

  return { processed: jobs.length, succeeded, failed };
}
