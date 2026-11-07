import "server-only";
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AUDIT_LOGS_EXPORT_BATCH_SIZE,
  AUDIT_LOGS_EXPORT_MAX_ROWS,
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
 * Database business writes are audited by transactional triggers. Events from
 * Auth, exports and other external operations enter a private durable outbox.
 * Success from recordAudit means the event was accepted, even if delivery to
 * audit_logs needs a retry. Login/export refuse success if acceptance fails.
 * The maintenance cron retries delivery and reports exhausted events as errors.
 */

export { AUDIT_LOGS_EXPORT_BATCH_SIZE, AUDIT_LOGS_EXPORT_MAX_ROWS };

export type AuditLogRow = {
  id: string;
  organizationId: string;
  actorId: string;
  deletedActorId?: string | null;
  actorRole: "admin" | "user";
  actorName: string | null;
  actorEmail?: string | null;
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
  deleted_actor_id?: string | null;
  actor_name_snapshot?: string | null;
  actor_email_snapshot?: string | null;
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
    deletedActorId: row.deleted_actor_id ?? null,
    actorRole: row.actor_role === "admin" ? "admin" : "user",
    // Filled in by `hydrateAuditActorDetails` after a single profiles lookup.
    actorName: null,
    actorEmail: null,
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
 * Durably accept one event. A lost acknowledgement is retried with the same ID.
 */
export async function recordAudit(
  input: {
    organizationId: string;
    actorId: string;
    actorRole: "admin" | "user";
    action: AuditAction;
    targetKind: AuditTargetKind;
    targetId: string | null;
    metadata?: Record<string, unknown>;
  },
  options?: { abortSignal?: AbortSignal; timeoutMs?: number },
): Promise<ServiceResult<{ id: string }>> {
  const signal = options?.abortSignal ?? AbortSignal.timeout(options?.timeoutMs ?? 2_500);
  if (signal?.aborted) {
    return err("db_error", "Ghi log kiểm toán bị hủy do quá thời gian");
  }

  let service: SupabaseClient;
  try {
    service = await getService();
  } catch (error) {
    return dbError("recordAudit", error);
  }

  const id = randomUUID();
  const payload = {
    p_id: id, p_organization_id: input.organizationId, p_actor_id: input.actorId,
    p_actor_role: input.actorRole, p_action: input.action, p_target_kind: input.targetKind,
    p_target_id: input.targetId, p_metadata: input.metadata ?? {},
  };
  let lastError: unknown;
  // A response can be lost after commit. Retry the same event ID, never a new one.
  for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
    try {
      const { data, error } = await service.rpc("enqueue_audit_event", payload).abortSignal(signal);
      if (!error && data?.id === id) return ok({ id });
      lastError = error ?? new Error("Audit event acknowledgement unavailable");
    } catch (error) { lastError = error; }
  }
  return dbError("recordAudit.enqueue", lastError ?? new Error("Audit request timed out"));
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
export async function recordCurrentUserAudit(
  input: {
    action: AuditAction;
    targetKind: AuditTargetKind;
    targetId: string | null;
    metadata?: Record<string, unknown>;
  },
  options?: { abortSignal?: AbortSignal; timeoutMs?: number },
): Promise<void> {
  const signal = options?.abortSignal ?? (options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);
  if (signal?.aborted) return;

  try {
    const user = await getCurrentUser(signal ? { abortSignal: signal } : undefined);
    if (!user || signal?.aborted) return;

    const result = await recordAudit(
      {
        organizationId: user.organizationId,
        actorId: user.id,
        actorRole: user.role,
        action: input.action,
        targetKind: input.targetKind,
        targetId: input.targetId,
        metadata: input.metadata,
      },
      signal ? { abortSignal: signal } : undefined,
    );

    if (!result.ok) {
      console.error(
        "[audit:recordCurrentUserAudit]",
        result.code,
        result.message ?? "",
      );
    }
  } catch (error) {
    if (!signal?.aborted) {
      console.error("[audit:recordCurrentUserAudit]", error);
    }
  }
}

const AUDIT_SELECT_COLUMNS =
  "id, organization_id, actor_id, deleted_actor_id, actor_name_snapshot, actor_email_snapshot, actor_role, action, target_kind, target_id, metadata, created_at";

function applyAuditFilter<T extends {
  or: (filters: string) => T;
  eq: (column: string, value: string) => T;
  gte: (column: string, value: string) => T;
  lt: (column: string, value: string) => T;
}>(query: T, filter: Pick<LogsFilter, "actorId" | "action" | "from" | "to">): T {
  let next = query;
  if (filter.actorId) {
    next = next.or(`actor_id.eq.${filter.actorId},deleted_actor_id.eq.${filter.actorId}`);
  }
  if (filter.action) {
    next = next.eq("action", filter.action);
  }
  if (filter.from) {
    next = next.gte("created_at", filter.from);
  }
  if (filter.to) {
    next = next.lt("created_at", filter.to);
  }
  return next;
}

async function hydrateAuditActorDetails(
  service: SupabaseClient,
  rows: AuditRowDb[],
): Promise<AuditLogRow[]> {
  // Resolve every distinct actor to its display name and email.
  // A profile that no longer exists, or the system tombstone that a hard-deleted
  // actor is re-pointed to (round 4), resolves to its stored actor snapshot
  // (or `null` when no snapshot exists — the UI then shows "[Người dùng đã xoá]").
  const actorNames = new Map<string, string | null>();
  const actorEmails = new Map<string, string | null>();
  const actorIds = [...new Set(rows.map((row) => row.actor_id))];

  if (actorIds.length > 0) {
    const { data: profiles } = await service
      .from("profiles")
      .select("id, full_name, is_tombstone")
      .in("id", actorIds);

    const liveActorIds: string[] = [];
    for (const profile of (profiles ?? []) as {
      id: string;
      full_name: string | null;
      is_tombstone: boolean | null;
    }[]) {
      if (profile.is_tombstone) {
        actorNames.set(profile.id, null);
      } else {
        actorNames.set(profile.id, profile.full_name ?? null);
        liveActorIds.push(profile.id);
      }
    }

    if (liveActorIds.length > 0) {
      const authEmails = await resolveAuthEmails(service, liveActorIds);
      for (const [id, email] of authEmails) {
        actorEmails.set(id, email);
      }
    }
  }

  return rows.map((row) => ({
    ...rowFromDb(row),
    actorName: actorNames.get(row.actor_id) ?? row.actor_name_snapshot ?? null,
    actorEmail: actorEmails.get(row.actor_id) ?? row.actor_email_snapshot ?? null,
  }));
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
    .select(AUDIT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  query = applyAuditFilter(query, filter);

  const from = (filter.page - 1) * filter.pageSize;
  const to = from + filter.pageSize - 1;
  query = query.range(from, to);

  const { data, error } = await query;

  if (error) {
    return dbError("listAuditLogs", error);
  }

  const rows = (data ?? []) as AuditRowDb[];
  return ok({ rows: await hydrateAuditActorDetails(service, rows) });
}

export type AuditLogsExportResult = {
  rows: AuditLogRow[];
  total: number;
  truncated: boolean;
  maxRows: number;
};

/**
 * Paginated export reader (A12): fetches all matching audit events up to
 * `AUDIT_LOGS_EXPORT_MAX_ROWS` (5,000) in deterministic 500-row batches and
 * reports exact `total` + `truncated` metadata so exports never silently stop
 * at 200 rows.
 */
export async function exportAuditLogs(
  organizationId: string,
  filter: Pick<LogsFilter, "actorId" | "action" | "from" | "to">,
  options?: { maxRows?: number },
): Promise<ServiceResult<AuditLogsExportResult>> {
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
    return dbError("exportAuditLogs", error);
  }

  const maxRows = Math.max(
    1,
    Math.min(options?.maxRows ?? AUDIT_LOGS_EXPORT_MAX_ROWS, AUDIT_LOGS_EXPORT_MAX_ROWS),
  );

  let countQuery = service
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  countQuery = applyAuditFilter(countQuery, filter);

  const { count, error: countError } = await countQuery;
  if (countError) {
    return dbError("exportAuditLogs.count", countError);
  }

  const collected: AuditRowDb[] = [];
  let offset = 0;

  while (collected.length < maxRows) {
    const remaining = maxRows - collected.length;
    const batchSize = Math.min(AUDIT_LOGS_EXPORT_BATCH_SIZE, remaining);

    let batchQuery = service
      .from("audit_logs")
      .select(AUDIT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    batchQuery = applyAuditFilter(batchQuery, filter).range(
      offset,
      offset + batchSize - 1,
    );

    const { data, error } = await batchQuery;
    if (error) {
      return dbError("exportAuditLogs.batch", error);
    }

    const batch = (data ?? []) as AuditRowDb[];
    collected.push(...batch);

    if (batch.length < batchSize) {
      break;
    }
    offset += batch.length;
  }

  const hydrated = await hydrateAuditActorDetails(service, collected);
  const total = Math.max(count ?? 0, hydrated.length);

  return ok({
    rows: hydrated,
    total,
    truncated: total > hydrated.length,
    maxRows,
  });
}

const actorEmailCache = new Map<string, { email: string; timestamp: number }>();
const CACHE_TTL_MS = 60_000;

async function resolveAuthEmails(
  service: SupabaseClient,
  actorIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!actorIds.length || !service.auth?.admin?.getUserById) return result;

  const now = Date.now();
  const missingIds: string[] = [];

  for (const id of actorIds) {
    const cached = actorEmailCache.get(id);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      result.set(id, cached.email);
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length === 0) return result;

  // Tra cứu chính xác chỉ các actorId của tổ chức cần hiển thị trên trang hiện hành.
  // Tuyệt đối không gọi listUsers toàn hệ thống để tránh nạp email của các tổ chức khác vào bộ nhớ.
  // Dùng worker pool concurrency tối đa 10 luồng xử lý theo dạng sliding window (hết việc này nhận việc kế tiếp ngay).
  let index = 0;
  const workers = Array.from({ length: Math.min(missingIds.length, 10) }, async () => {
    while (index < missingIds.length) {
      const id = missingIds[index++];
      try {
        const { data, error } = await service.auth.admin.getUserById(id);
        if (!error && data?.user?.email) {
          result.set(id, data.user.email);
          actorEmailCache.set(id, { email: data.user.email, timestamp: now });
        }
      } catch {
        // Fallback for mocked or restricted environments
      }
    }
  });
  await Promise.all(workers);

  return result;
}

/** Helper to record logout audit for the signed-in session user. */
export async function recordLogoutAudit(): Promise<void> {
  await recordCurrentUserAudit({
    action: "logout",
    targetKind: "user",
    targetId: null,
  });
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

  query = applyAuditFilter(query, filter);

  const { count, error } = await query;

  if (error) {
    return dbError("countAuditLogs", error);
  }

  return ok({ total: count ?? 0 });
}
