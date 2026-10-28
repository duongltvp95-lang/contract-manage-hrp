import "server-only";

import { addDays, format } from "date-fns";

import { resolveExpiryPreset } from "@/lib/contracts-query";
import { createClient } from "@/lib/supabase/server";

import { CONTRACT_COLUMNS, type ContractRow } from "./contracts";
import { dbError, ok, type ServiceResult } from "./types";

/**
 * Dashboard service — plan sections 67, 68, 78.
 *
 * The expiry windows come from `resolveExpiryPreset()` in
 * `lib/contracts-query.ts`, which already implements plan sections 69 and 70 for
 * the contracts list. Reimplementing `today + 90 days` here would be exactly the
 * kind of duplicated rule section 2 warns about — and the two definitions would
 * eventually disagree, so the dashboard and the list filter would stop matching.
 *
 * Archived contracts are excluded everywhere (plan section 66).
 */

export type ContractMetrics = {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  archived: number;
};

/**
 * A dashboard contract with its partner link resolved (round 15).
 *
 * `partnerName` is the linked partner's name (null when there is no link);
 * `companies` are the linked partner's company names (empty when none). RLS is
 * applied once per sub-query row, not per contract.
 */
export type DashboardContractRow = ContractRow & {
  partnerName: string | null;
  /**
   * Round 37 — the company the contract is signed for (`contracts.company_id`),
   * not the partner's full company set. 0 or 1 element.
   */
  companies: string[];
};

/** How many rows the dashboard lists show. */
export const DASHBOARD_LIST_LIMIT = 5;

/** Local "today" as `YYYY-MM-DD`, the format the `date` columns use. */
export function todayIso(today: Date = new Date()): string {
  return format(today, "yyyy-MM-dd");
}

function expiryWindow(preset: "expiring90" | "expired", today: Date) {
  return resolveExpiryPreset(preset, today);
}

/**
 * The three dashboard cards (plan section 67).
 *
 * Counted with `head: true` so PostgREST returns only the exact count — no rows
 * travel over the wire for a number.
 */
export async function getContractMetrics(
  organizationId: string,
  today: Date = new Date(),
): Promise<ServiceResult<ContractMetrics>> {
  const supabase = await createClient();

  // Tối ưu (Round 38+): Dùng RPC get_dashboard_metrics để tính cả 4 chỉ số trong 1 câu SQL duy nhất
  // thay vì 4 HTTP round-trips riêng biệt (giảm từ 14s xuống <0.5s).
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_dashboard_metrics", {
      org_id: organizationId,
      today_date: todayIso(today),
    });

    if (!rpcError && rpcData) {
      const typed = rpcData as {
        total: number;
        expiringSoon: number;
        expired: number;
        archived: number;
      };
      const total = typed.total ?? 0;
      const expired = typed.expired ?? 0;
      const active = Math.max(0, total - expired);
      const archived = typed.archived ?? 0;
      return ok({
        total,
        active,
        expiringSoon: typed.expiringSoon ?? 0,
        expired,
        archived,
      });
    }
  } catch {
    // fallback nếu RPC chưa được phát hiện
  }

  // Fallback: 4 truy vấn đếm song song nếu RPC không khả dụng
  const base = () =>
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("archived_at", null);

  const soon = expiryWindow("expiring90", today);
  const past = expiryWindow("expired", today);

  const [totalResult, soonResult, expiredResult, archivedResult] = await Promise.all([
    base(),
    base().gte("expiry_date", soon.gte!).lte("expiry_date", soon.lte!),
    base().lt("expiry_date", past.lt!),
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .not("archived_at", "is", null),
  ]);

  const failure =
    totalResult.error ??
    soonResult.error ??
    expiredResult.error ??
    archivedResult.error;
  if (failure) {
    return dbError("getContractMetrics", failure);
  }

  const total = totalResult.count ?? 0;
  const expired = expiredResult.count ?? 0;
  const active = Math.max(0, total - expired);
  const archived = archivedResult.count ?? 0;

  return ok({
    total,
    active,
    expiringSoon: soonResult.count ?? 0,
    expired,
    archived,
  });
}

const DASHBOARD_CONTRACT_COLUMNS = `
  ${CONTRACT_COLUMNS},
  partner:partners(name),
  company:companies(name)
`;

type EmbeddedContractRow = ContractRow & {
  partner: { name: string } | null;
  company: { name: string } | null;
};

function formatDashboardRow(row: EmbeddedContractRow): DashboardContractRow {
  const { partner, company, ...contract } = row;
  return {
    ...contract,
    partnerName: partner?.name ?? null,
    companies: company?.name ? [company.name] : [],
  };
}

/** Newest contracts first (plan section 67: "Recent Contracts"). */
export async function getRecentContracts(
  organizationId: string,
  limit: number = DASHBOARD_LIST_LIMIT,
): Promise<ServiceResult<DashboardContractRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(DASHBOARD_CONTRACT_COLUMNS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return dbError("getRecentContracts", error);
  }

  const rows = (data ?? []) as unknown as EmbeddedContractRow[];
  return ok(rows.map(formatDashboardRow));
}

/**
 * Contracts expiring within 90 days, soonest first (plan sections 67, 69).
 *
 * Sorted by `expiry_date` ascending because the useful question is "what do I
 * have to deal with next?" — not "what did I create most recently?".
 */
export async function getExpiringContracts(
  organizationId: string,
  today: Date = new Date(),
  limit: number = DASHBOARD_LIST_LIMIT,
): Promise<ServiceResult<DashboardContractRow[]>> {
  const supabase = await createClient();
  const window = expiryWindow("expiring90", today);

  const { data, error } = await supabase
    .from("contracts")
    .select(DASHBOARD_CONTRACT_COLUMNS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .gte("expiry_date", window.gte!)
    .lte("expiry_date", window.lte!)
    .order("expiry_date", { ascending: true })
    .limit(limit);

  if (error) {
    return dbError("getExpiringContracts", error);
  }

  const rows = (data ?? []) as unknown as EmbeddedContractRow[];
  return ok(rows.map(formatDashboardRow));
}

/** Exposed so the report and tests can state the window without guessing. */
export function expiringWindowBounds(today: Date = new Date()): {
  from: string;
  to: string;
} {
  return {
    from: todayIso(today),
    to: format(addDays(today, 90), "yyyy-MM-dd"),
  };
}

/**
 * Contracts with no signed date, no expiry date, or indefinite duration (round 48).
 * Ordered by newest created first so contracts needing date check appear on top.
 */
export async function getUndatedContracts(
  organizationId: string,
  limit: number = DASHBOARD_LIST_LIMIT,
): Promise<ServiceResult<{ rows: DashboardContractRow[]; total: number }>> {
  const supabase = await createClient();

  const { data, count, error } = await supabase
    .from("contracts")
    .select(DASHBOARD_CONTRACT_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .or("signed_date.is.null,expiry_date.is.null,duration_text.ilike.%không xác định%,duration_text.ilike.%vô thời hạn%,duration_text.ilike.%không giới hạn%")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return dbError("getUndatedContracts", error);
  }

  const rows = (data ?? []) as unknown as EmbeddedContractRow[];
  return ok({
    rows: rows.map(formatDashboardRow),
    total: count ?? rows.length,
  });
}

/**
 * Đếm số hợp đồng chưa có tệp đính kèm (round 49).
 * Dùng RPC count_contract_files để đếm file_count = 0.
 */
export async function countNoFileContracts(
  organizationId: string,
): Promise<ServiceResult<number>> {
  const supabase = await createClient();

  // Lấy tất cả contract id không có file trong contract_files
  const { count, error } = await supabase
    .from("contracts")
    .select(
      `id, contract_files!left(contract_id)`,
      { count: "exact", head: false },
    )
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .is("contract_files.contract_id", null);

  if (error) {
    return dbError("countNoFileContracts", error);
  }

  return ok(count ?? 0);
}
