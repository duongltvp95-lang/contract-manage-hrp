import "server-only";

import {
  PartnerSchema,
  UpdatePartnerSchema,
} from "@schemas/partner";

import { createClient } from "@/lib/supabase/server";
import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * Partner service — feature round 2, part 1.
 *
 * Every function takes `organizationId` from the caller's session
 * (`resolveAccess()`); the client never supplies it. RLS enforces the same rule
 * at the database level, so this is a second, explicit line of defence — the
 * same arrangement `contracts.ts` uses.
 *
 * There is deliberately no `deletePartner()`. Partners are referenced by
 * contracts, the database revokes DELETE from `authenticated`, and no DELETE
 * policy exists. If a partner ever needs to be removed it will be an owner
 * decision with the referencing contracts in view, not a service function.
 */

export type PartnerRow = {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export const PARTNER_COLUMNS = "id, organization_id, name, created_at, updated_at";

/**
 * A partner plus how many contracts point at it.
 *
 * Archived contracts are not counted: the list hides them, the dashboard hides
 * them, and a count that includes rows the user cannot see would never match
 * the number of contracts on the partner's own page.
 */
export type PartnerWithCount = PartnerRow & { contract_count: number };

export type PartnerContext = {
  organizationId: string;
};

/**
 * Counts contracts per partner for the given partners.
 *
 * One extra query rather than a PostgREST embedded count, mirroring
 * `countFilesByContract` in `contracts.ts`: the shape stays explicit and RLS
 * applies exactly once per row.
 */
async function countContractsByPartner(
  partnerIds: string[],
  organizationId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (partnerIds.length === 0) return counts;

  const supabase = await createClient();
  const { data } = await supabase
    .from("contracts")
    .select("partner_id")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .in("partner_id", partnerIds);

  for (const row of (data ?? []) as { partner_id: string | null }[]) {
    if (!row.partner_id) continue;
    counts.set(row.partner_id, (counts.get(row.partner_id) ?? 0) + 1);
  }

  return counts;
}

/**
 * Every partner of the caller's organization, alphabetically, with its contract
 * count.
 *
 * The directory is expected to be small (tens to low hundreds per
 * organization), so this returns the whole list rather than paginating: it feeds
 * a `<select>` / combobox and a filter control, both of which need every option.
 */
export async function listPartners({
  organizationId,
}: PartnerContext): Promise<ServiceResult<PartnerWithCount[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partners")
    .select(PARTNER_COLUMNS)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    return dbError("listPartners", error);
  }

  const rows = (data ?? []) as PartnerRow[];
  const counts = await countContractsByPartner(
    rows.map((row) => row.id),
    organizationId,
  );

  return ok(
    rows.map((row) => ({ ...row, contract_count: counts.get(row.id) ?? 0 })),
  );
}

/** Returns the partner only when it belongs to `organizationId`. */
export async function getPartner(
  id: string,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partners")
    .select(PARTNER_COLUMNS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return dbError("getPartner", error);
  }

  if (!data) {
    // A partner in another organization is reported exactly like one that does
    // not exist, so nothing about the other tenant leaks.
    return err("not_found", "Không tìm thấy đối tác");
  }

  return ok(data as PartnerRow);
}

/**
 * Creates one partner for the caller's organization.
 *
 * `input` is `unknown` on purpose: a server action hands over whatever the client
 * sent, and `PartnerSchema.safeParse` below is the boundary that decides whether
 * it is usable. Typing the parameter would only move the cast one layer up.
 */
export async function createPartner(
  input: unknown,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerRow>> {
  const parsed = PartnerSchema.safeParse(input);

  if (!parsed.success) {
    return err(
      "validation",
      "Dữ liệu đối tác không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partners")
    .insert({
      // From the session, never from the request body.
      organization_id: organizationId,
      name: parsed.data.name,
    })
    .select(PARTNER_COLUMNS)
    .single();

  if (error) {
    return dbError("createPartner", error);
  }

  return ok(data as PartnerRow);
}

/**
 * Renames an existing partner.
 *
 * Only the keys the caller actually sent are written — same reasoning as
 * `updateContract`: a blind full-row update would clear fields nobody mentioned.
 */
export async function updatePartner(
  id: string,
  input: unknown,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerRow>> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const parsed = UpdatePartnerSchema.safeParse(raw);

  if (!parsed.success) {
    return err(
      "validation",
      "Dữ liệu đối tác không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const patch: Record<string, string> = {};
  if ("name" in raw && parsed.data.name !== undefined) {
    patch.name = parsed.data.name;
  }

  if (Object.keys(patch).length === 0) {
    return err("validation", "Không có thay đổi nào để lưu");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partners")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select(PARTNER_COLUMNS)
    .maybeSingle();

  if (error) {
    return dbError("updatePartner", error);
  }

  if (!data) {
    // RLS filtered it, or it is gone. Same answer either way.
    return err("not_found", "Không tìm thấy đối tác");
  }

  return ok(data as PartnerRow);
}
