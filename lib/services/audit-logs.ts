import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type AuditAction,
  type AuditTargetKind,
  type LogsFilter,
} from "@schemas/audit-log";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * Audit-log service — feature round 3, part 1.
 *
 * Three things to keep in mind:
 *
 *   1. The table is INSERT-only for the application. `recordAudit()` uses the
 *      service-role client, which bypasses RLS — that is the entire point of
 *      the policy decision (no authenticated INSERT policy, and no UPDATE/
 *      DELETE policy either). It also means a failure to log cannot be fixed
 *      by retrying through PostgREST.
 *   2. The caller is already authorised (`requireAdmin()` ran before us). We
 *      do not re-check the role here: that is the layer that decides who can
 *      log, and a log helper has no business second-guessing it.
 *   3. `recordAudit()` deliberately returns a `ServiceResult` rather than
 *      throwing. The caller is expected to `try/catch` (or pattern-match the
 *      result) and SWALLOW the failure: a missing log line is much less bad
 *      than blocking a real user-management action because the audit table is
 *      momentarily unhappy.
 */

export type AuditLogRow = {
  id: string;
  organizationId: string;
  actorId: string;
  actorRole: "admin" | "user";
  action: AuditAction;
  targetKind: AuditTargetKind;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditRowDb = {
  id: string;
  organization_id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_kind: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function rowFromDb(row: AuditRowDb): AuditLogRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorId: row.actor_id,
    actorRole: row.actor_role === "admin" ? "admin" : "user",
    action: row.action as AuditAction,
    targetKind: row.target_kind as AuditTargetKind,
    targetId: row.target_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

/** Returns the service-role client. Tests can swap this in to stub PostgREST. */
async function getService(): Promise<SupabaseClient> {
  return createAdminClient();
}

/**
 * Write one row. The caller chooses to swallow the error — see the file-level
 * comment for why.
 */
export async function recordAudit(input: {
  organizationId: string;
  actorId: string;
  actorRole: "admin" | "user";
  action: AuditAction;
  targetKind: AuditTargetKind;
  targetId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ServiceResult<{ id: string }>> {
  let service: SupabaseClient;
  try {
    service = await getService();
  } catch (error) {
    return dbError("recordAudit", error);
  }

  const { data, error } = await service
    .from("audit_logs")
    .insert({
      organization_id: input.organizationId,
      actor_id: input.actorId,
      actor_role: input.actorRole,
      action: input.action,
      target_kind: input.targetKind,
      target_id: input.targetId,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) {
    return dbError("recordAudit", error);
  }

  return ok({ id: (data as { id: string }).id });
}

/**
 * Fire-and-forget audit write that attributes the entry to the CURRENT user.
 *
 * Round 8 business actions call this from inside a server action / route, where
 * the signed-in user is the actor. It resolves the actor (id + role + org) from
 * the session and swallows every failure: a missing log line must never block
 * the business action that produced it (see the file-level comment).
 *
 * The error is logged server-side when a write fails, so it is observable
 * without ever propagating to the caller.
 */
export async function recordCurrentUserAudit(input: {
  action: AuditAction;
  targetKind: AuditTargetKind;
  targetId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const result = await recordAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      actorRole: user.role,
      action: input.action,
      targetKind: input.targetKind,
      targetId: input.targetId,
      metadata: input.metadata,
    });

    if (!result.ok) {
      console.error(
        "[audit:recordCurrentUserAudit]",
        result.code,
        result.message ?? "",
      );
    }
  } catch (error) {
    console.error("[audit:recordCurrentUserAudit]", error);
  }
}

/**
 * Read logs for an organization, newest first. RLS restricts the row set to the
 * signed-in admin's organization, so we don't repeat that filter at the SQL
 * layer (the policy already does it). We DO sort/paginate here because the
 * admin expects a stable order and predictable page sizes.
 */
export async function listAuditLogs(
  organizationId: string,
  filter: LogsFilter,
): Promise<ServiceResult<{ rows: AuditLogRow[] }>> {
  const access = await getCurrentUser();
  if (!access) {
    return err("unauthenticated", "Bạn cần đăng nhập");
  }
  if (access.role !== "admin") {
    return err("forbidden", "Chỉ quản trị viên mới xem được nhật ký");
  }
  if (access.organizationId !== organizationId) {
    return err("forbidden", "Không thể xem nhật ký của tổ chức khác");
  }

  let service: SupabaseClient;
  try {
    service = await getService();
  } catch (error) {
    return dbError("listAuditLogs", error);
  }

  let query = service
    .from("audit_logs")
    .select(
      "id, organization_id, actor_id, actor_role, action, target_kind, target_id, metadata, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (filter.actorId) {
    query = query.eq("actor_id", filter.actorId);
  }
  if (filter.action) {
    query = query.eq("action", filter.action);
  }
  if (filter.from) {
    query = query.gte("created_at", filter.from);
  }
  if (filter.to) {
    query = query.lt("created_at", filter.to);
  }

  const from = (filter.page - 1) * filter.pageSize;
  const to = from + filter.pageSize - 1;
  query = query.range(from, to);

  const { data, error } = await query;

  if (error) {
    return dbError("listAuditLogs", error);
  }

  const rows = (data ?? []) as AuditRowDb[];
  return ok({ rows: rows.map(rowFromDb) });
}

/**
 * Total count for the same filter. Kept separate from `listAuditLogs` so the
 * table-render path can skip the COUNT(*) (which is `O(N)` against a 100k-row
 * audit table) when the UI does not need it.
 */
export async function countAuditLogs(
  organizationId: string,
  filter: LogsFilter,
): Promise<ServiceResult<{ total: number }>> {
  const access = await getCurrentUser();
  if (!access) {
    return err("unauthenticated", "Bạn cần đăng nhập");
  }
  if (access.role !== "admin") {
    return err("forbidden", "Chỉ quản trị viên mới xem được nhật ký");
  }
  if (access.organizationId !== organizationId) {
    return err("forbidden", "Không thể xem nhật ký của tổ chức khác");
  }

  let service: SupabaseClient;
  try {
    service = await getService();
  } catch (error) {
    return dbError("countAuditLogs", error);
  }

  let query = service
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (filter.actorId) {
    query = query.eq("actor_id", filter.actorId);
  }
  if (filter.action) {
    query = query.eq("action", filter.action);
  }
  if (filter.from) {
    query = query.gte("created_at", filter.from);
  }
  if (filter.to) {
    query = query.lt("created_at", filter.to);
  }

  const { count, error } = await query;

  if (error) {
    return dbError("countAuditLogs", error);
  }

  return ok({ total: count ?? 0 });
}
