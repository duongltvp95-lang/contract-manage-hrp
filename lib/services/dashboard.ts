import "server-only";

import { addDays, format } from "date-fns";

import { resolveExpiryPreset } from "@/lib/contracts-query";
import { createClient } from "@/lib/supabase/server";

import { CONTRACT_COLUMNS, type ContractRow } from "./contracts";
import { companiesForPartners } from "./partners";
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
  expiringSoon: number;
  expired: number;
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

  const base = () =>
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("archived_at", null);

  const soon = expiryWindow("expiring90", today);
  const past = expiryWindow("expired", today);

  const [totalResult, soonResult, expiredResult] = await Promise.all([
    base(),
    base().gte("expiry_date", soon.gte!).lte("expiry_date", soon.lte!),
    base().lt("expiry_date", past.lt!),
  ]);

  const failure = totalResult.error ?? soonResult.error ?? expiredResult.error;
  if (failure) {
    return dbError("getContractMetrics", failure);
  }

  return ok({
    total: totalResult.count ?? 0,
    expiringSoon: soonResult.count ?? 0,
    expired: expiredResult.count ?? 0,
  });
}

/** Newest contracts first (plan section 67: "Recent Contracts"). */
export async function getRecentContracts(
  organizationId: string,
  limit: number = DASHBOARD_LIST_LIMIT,
): Promise<ServiceResult<DashboardContractRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(CONTRACT_COLUMNS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return dbError("getRecentContracts", error);
  }

  return ok(await attachPartnerInfo((data ?? []) as ContractRow[]));
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
    .select(CONTRACT_COLUMNS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .gte("expiry_date", window.gte!)
    .lte("expiry_date", window.lte!)
    .order("expiry_date", { ascending: true })
    .limit(limit);

  if (error) {
    return dbError("getExpiringContracts", error);
  }

  return ok(await attachPartnerInfo((data ?? []) as ContractRow[]));
}

/**
 * Resolves each contract's partner name + company names with two sub-queries
 * (partners for names, the partner_companies junction for companies), keyed by
 * the distinct partner ids — RLS applies once per row, not once per contract.
 */
async function attachPartnerInfo(rows: ContractRow[]): Promise<DashboardContractRow[]> {
  if (rows.length === 0) return [];

  const partnerIds = [
    ...new Set(
      rows.map((row) => row.partner_id).filter((id): id is string => Boolean(id)),
    ),
  ];

  const nameByPartner = new Map<string, string>();
  if (partnerIds.length > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("partners")
      .select("id, name")
      .in("id", partnerIds);
    for (const row of (data ?? []) as { id: string; name: string }[]) {
      nameByPartner.set(row.id, row.name);
    }
  }

  const companiesByPartner = await companiesForPartners(partnerIds);

  return rows.map((row) => ({
    ...row,
    partnerName: row.partner_id ? (nameByPartner.get(row.partner_id) ?? null) : null,
    companies: row.partner_id ? (companiesByPartner.get(row.partner_id) ?? []) : [],
  }));
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
