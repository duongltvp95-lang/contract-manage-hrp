/**
 * Partner merge rules — round 25, part 1.
 *
 * PURE module: no Supabase, no Next.js. The Excel import deduplicates incoming
 * rows against the existing directory:
 *
 *   1. COMPANY FILTER — when the file has a "Công ty" column, only partners
 *      that SHARE at least one company with the incoming row are candidates.
 *      No overlap = a different partner → create new, never overwrite.
 *      Without the column, the whole directory is considered.
 *   2. FIVE KEYS, in priority order, within the filtered set: tax code →
 *      abbreviation → name → address → region. A key participates only when
 *      the incoming value is non-empty; every comparison is diacritics-folded
 *      (`foldText`), so "Đăng Khoa" matches "dang khoa".
 */

import { foldText } from "@/lib/partner-display";

import type { PartnerStatus } from "@schemas/partner";

/** An existing partner, in the shape the merge needs. */
export type MergeablePartner = {
  id: string;
  name: string;
  tax_code: string | null;
  abbreviation: string | null;
  region: string | null;
  address: string | null;
  status: PartnerStatus;
  /** Resolved company NAMES (e.g. ["HRP", "HR VN"]). */
  companies: string[];
};

/** One incoming import row. */
export type MergeIncoming = {
  name: string;
  taxCode: string;
  abbreviation: string;
  region: string;
  address: string;
  status: PartnerStatus | null;
  /** Resolved company names; empty list only when the column is absent. */
  companies: string[];
  /** True when the file actually has a "Công ty" column. */
  hasCompanyColumn: boolean;
};

/**
 * Finds the partner an incoming row should MERGE INTO, or null to create new.
 */
export function matchExistingPartner(
  existing: MergeablePartner[],
  incoming: MergeIncoming,
): MergeablePartner | null {
  let candidates = existing;

  // Step 1 — company overlap (only when the file carries the column).
  if (incoming.hasCompanyColumn) {
    candidates = existing.filter((partner) =>
      partner.companies.some((company) => incoming.companies.includes(company)),
    );
    if (candidates.length === 0) return null;
  }

  // Step 2 — the five keys, strongest first.
  const taxCode = incoming.taxCode.trim();
  if (taxCode) {
    const folded = foldText(taxCode);
    const match = candidates.find(
      (partner) => Boolean(partner.tax_code) && foldText(partner.tax_code!) === folded,
    );
    if (match) return match;
  }

  const abbreviation = incoming.abbreviation.trim();
  if (abbreviation) {
    const folded = foldText(abbreviation);
    const match = candidates.find(
      (partner) =>
        Boolean(partner.abbreviation) && foldText(partner.abbreviation!) === folded,
    );
    if (match) return match;
  }

  const nameFolded = foldText(incoming.name);
  const byName = candidates.find(
    (partner) => foldText(partner.name) === nameFolded,
  );
  if (byName) return byName;

  const address = incoming.address.trim();
  if (address) {
    const folded = foldText(address);
    const match = candidates.find(
      (partner) => Boolean(partner.address) && foldText(partner.address!) === folded,
    );
    if (match) return match;
  }

  const region = incoming.region.trim();
  if (region) {
    const folded = foldText(region);
    const match = candidates.find(
      (partner) => Boolean(partner.region) && foldText(partner.region!) === folded,
    );
    if (match) return match;
  }

  return null;
}

export type MergePatch = {
  /** Fields to write, already trimmed / nulled. */
  patch: Record<string, string | null>;
  /** The keys that ACTUALLY changed (for the update_partner audit). */
  changed: string[];
  /** Company NAMES to add to the junction (union). Empty when none. */
  companiesToAdd: string[];
};

/**
 * Applies the merge prediction to a directory entry — used by BOTH the import
 * (after a real update) and the preview (to predict what a later row in the
 * same file would match).
 */
export function mergeDirectoryEntry(
  existing: MergeablePartner,
  incoming: MergeIncoming,
): MergeablePartner {
  const { patch, companiesToAdd } = buildMergePatch(existing, incoming);

  return {
    ...existing,
    name: patch.name ?? existing.name,
    tax_code: patch.tax_code !== undefined ? patch.tax_code : existing.tax_code,
    address: patch.address !== undefined ? patch.address : existing.address,
    region: patch.region !== undefined ? patch.region : existing.region,
    abbreviation:
      patch.abbreviation !== undefined ? patch.abbreviation : existing.abbreviation,
    status: (patch.status as PartnerStatus | undefined) ?? existing.status,
    companies: [...new Set([...existing.companies, ...companiesToAdd])],
  };
}

/**
 * Builds the overwrite patch: a non-empty incoming value wins; empty incoming
 * values leave the existing field alone. The name always wins. Companies are a
 * UNION only when the file carries the "Công ty" column.
 */
export function buildMergePatch(
  existing: MergeablePartner,
  incoming: MergeIncoming,
): MergePatch {
  const patch: Record<string, string | null> = {};
  const changed: string[] = [];

  const existingValue = (value: string | null) => (value ?? "").trim();

  if (incoming.name.trim() !== existingValue(existing.name)) {
    patch.name = incoming.name.trim();
    changed.push("name");
  }

  const address = incoming.address.trim();
  if (address && address !== existingValue(existing.address)) {
    patch.address = address;
    changed.push("address");
  }

  const abbreviation = incoming.abbreviation.trim();
  if (abbreviation && abbreviation !== existingValue(existing.abbreviation)) {
    patch.abbreviation = abbreviation;
    changed.push("abbreviation");
  }

  const region = incoming.region.trim();
  if (region && region !== existingValue(existing.region)) {
    patch.region = region;
    changed.push("region");
  }

  const taxCode = incoming.taxCode.trim();
  if (taxCode && taxCode !== existingValue(existing.tax_code)) {
    patch.tax_code = taxCode;
    changed.push("taxCode");
  }

  if (incoming.status && incoming.status !== existing.status) {
    patch.status = incoming.status;
    changed.push("status");
  }

  const companiesToAdd: string[] = [];
  if (incoming.hasCompanyColumn) {
    const existingNames = new Set(existing.companies);
    for (const name of incoming.companies) {
      if (!existingNames.has(name) && !companiesToAdd.includes(name)) {
        companiesToAdd.push(name);
      }
    }
    if (companiesToAdd.length > 0) changed.push("companies");
  }

  return { patch, changed, companiesToAdd };
}
