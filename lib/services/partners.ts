import "server-only";

import {
  PartnerSchema,
  UpdatePartnerSchema,
  type PartnerStatus,
} from "@schemas/partner";

import type { PartnerImportRow, PartnerImportRowReport } from "@/lib/partner-import";
import { getCurrentUser } from "@/lib/auth";
import { canDeleteEntities, BULK_DELETE_LIMIT } from "@/lib/delete-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PARTNER_SEARCH_LIMIT } from "@/lib/partner-display";
import { recordCurrentUserAudit } from "./audit-logs";
import type { BulkDeleteItem } from "./contracts";
import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * Partner service — feature round 2, part 1 + part 3.
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
 *
 * Round 2 part 3 added two OPTIONAL fields — `address` and `tax_code` — per
 * the Owner decision. The service writes them when present and leaves them
 * alone when omitted (the partial-update rule). Tax code is checked for
 * duplicates inside the caller's organization before insert / update, with a
 * readable Vietnamese error rather than a database unique-violation stack
 * trace. The database has no UNIQUE constraint on `tax_code` on purpose (so
 * historical data with duplicates is not blocked).
 */

export type PartnerRow = {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  tax_code: string | null;
  region: string | null;
  abbreviation: string | null;
  status: PartnerStatus;
  created_at: string;
  updated_at: string;
};

export const PARTNER_COLUMNS =
  "id, organization_id, name, address, tax_code, region, abbreviation, status, created_at, updated_at";

/**
 * A company an organization works with (round 10). Read-only for the app: the
 * rows are seeded (HRP / HR VN) and partners link to them through the junction.
 */
export type Company = {
  id: string;
  name: string;
};

/**
 * A partner plus how many contracts point at it.
 *
 * Archived contracts are not counted: the list hides them, the dashboard hides
 * them, and a count that includes rows the user cannot see would never match
 * the number of contracts on the partner's own page.
 */
export type PartnerWithCount = PartnerRow & {
  contract_count: number;
  companies: string[];
};

/** A partner plus its linked company names (round 10). */
export type PartnerDetail = PartnerRow & { companies: string[] };

export type PartnerContext = {
  organizationId: string;
};

/**
 * Counts contracts per partner for the given partners.
 *
 * One extra query rather than a PostgREST embedded count, mirroring
 * `countFilesByContract` in `contracts.ts`: the shape stays explicit and RLS
 * applies exactly once per row.
 *
 * Exported (round 23) so the partners export can reuse the same count.
 */
export async function countContractsByPartner(
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
 * The companies of the caller's organization (round 10). Small by design — the
 * seed is two rows — so this returns the whole list for the form and the import.
 */
export async function listCompanies({
  organizationId,
}: PartnerContext): Promise<ServiceResult<Company[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    return dbError("listCompanies", error);
  }

  return ok((data ?? []) as Company[]);
}

/** The company names linked to one partner, alphabetically. */
async function companiesForPartner(partnerId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_companies")
    .select("companies(name)")
    .eq("partner_id", partnerId);

  const names: string[] = [];
  for (const row of (data ?? []) as {
    companies: { name: string } | { name: string }[] | null;
  }[]) {
    const embedded = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    if (embedded?.name) names.push(embedded.name);
  }

  return names.sort();
}

/** Bulk company names per partner, one query for a whole page of partners. */
export async function companiesForPartners(
  partnerIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (partnerIds.length === 0) return result;

  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_companies")
    .select("partner_id, companies(name)")
    .in("partner_id", partnerIds);

  for (const row of (data ?? []) as {
    partner_id: string;
    companies: { name: string } | { name: string }[] | null;
  }[]) {
    const embedded = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    if (!embedded?.name) continue;
    result.set(row.partner_id, [...(result.get(row.partner_id) ?? []), embedded.name]);
  }

  return result;
}

/**
 * Rolls back a partner row the caller just created but whose junction insert
 * failed. The session client has no DELETE grant on `partners`, so this uses the
 * service-role client; if that is unavailable the orphan row is logged and left
 * (the caller still gets the error, so it is never silently half-saved).
 */
async function deletePartnerRollback(partnerId: string): Promise<void> {
  try {
    const admin = await createAdminClient();
    await admin.from("partners").delete().eq("id", partnerId);
  } catch (error) {
    console.error("[service:createPartner] rollback failed", error);
  }
}

/**
 * Every partner of the caller's organization, alphabetically, with its contract
 * count and linked company names.
 *
 * The directory is expected to be small (tens to low hundreds per
 * organization), so this returns the whole list rather than paginating: it feeds
 * a `<select>` / combobox and a filter control, both of which need every option.
 */
export async function listPartners({
  organizationId,
  status,
}: PartnerContext & {
  /** Round 20 — filter by status; absent = all (unchanged). */
  status?: PartnerStatus;
}): Promise<ServiceResult<PartnerWithCount[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("partners")
    .select(PARTNER_COLUMNS)
    .eq("organization_id", organizationId);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    return dbError("listPartners", error);
  }

  const rows = (data ?? []) as PartnerRow[];
  const [counts, companyMap] = await Promise.all([
    countContractsByPartner(rows.map((row) => row.id), organizationId),
    companiesForPartners(rows.map((row) => row.id)),
  ]);

  return ok(
    rows.map((row) => ({
      ...row,
      contract_count: counts.get(row.id) ?? 0,
      companies: (companyMap.get(row.id) ?? []).sort(),
    })),
  );
}

/** A partner as returned by the quick-search RPC (round 6). */
export type PartnerSearchRow = Pick<
  PartnerRow,
  "id" | "name" | "address" | "tax_code"
>;

/**
 * Quick search over the whole directory — round 6.
 *
 * The contract form combobox needs a fast lookup when the directory is large;
 * loading every partner into the page (the round 2 behaviour) stops scaling.
 * The RPC folds diacritics the same way `filterPartners` does and matches the
 * tax code as well, and its `security invoker` runs under RLS, so a caller can
 * only ever see their own organization's partners.
 */
export async function searchPartners(
  term: string,
): Promise<ServiceResult<PartnerSearchRow[]>> {
  const supabase = await createClient();
  const query = term.trim().slice(0, 100);

  const { data, error } = await supabase.rpc("search_partners", {
    term: query,
    lim: PARTNER_SEARCH_LIMIT,
  });

  if (error) {
    return dbError("searchPartners", error);
  }

  return ok((data ?? []) as PartnerSearchRow[]);
}

/** Returns the partner only when it belongs to `organizationId`. */
export async function getPartner(
  id: string,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerDetail>> {
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

  const companies = await companiesForPartner(id);
  return ok({ ...(data as PartnerRow), companies });
}

/**
 * Every same-organization partner that shares one of `taxCodes`, grouped by tax
 * code. One chunked `in` query for the whole batch rather than one query per
 * row: the single-code lookup below and the round 7 import both reuse this.
 *
 * Empty strings and non-strings are ignored, so callers can hand over raw
 * import rows without pre-cleaning them.
 */
async function findPartnersByTaxCodes(
  taxCodes: string[],
  organizationId: string,
): Promise<Map<string, PartnerRow[]>> {
  const result = new Map<string, PartnerRow[]>();
  const unique = [
    ...new Set(
      taxCodes.map((code) => (typeof code === "string" ? code.trim() : "")).filter(Boolean),
    ),
  ];

  if (unique.length === 0) return result;

  const supabase = await createClient();

  // PostgREST URLs have a practical length limit; chunk to stay well inside it.
  for (let start = 0; start < unique.length; start += 100) {
    const chunk = unique.slice(start, start + 100);
    const { data } = await supabase
      .from("partners")
      .select(PARTNER_COLUMNS)
      .eq("organization_id", organizationId)
      .in("tax_code", chunk);

    for (const row of (data ?? []) as PartnerRow[]) {
      if (!row.tax_code) continue;
      result.set(row.tax_code, [...(result.get(row.tax_code) ?? []), row]);
    }
  }

  return result;
}

/**
 * Finds a same-organization partner that shares `taxCode`. Used to surface a
 * readable Vietnamese duplicate-message before the database would return a
 * generic constraint error. There is no UNIQUE on `tax_code` (Owner-approved
 * decision), so this check is what catches the conflict.
 *
 * Returns `null` when no duplicate exists. Excludes the partner being updated
 * when an `excludeId` is supplied.
 */
async function findPartnerByTaxCode(
  taxCode: string,
  organizationId: string,
  excludeId?: string,
): Promise<PartnerRow | null> {
  const matches = (await findPartnersByTaxCodes([taxCode], organizationId)).get(
    taxCode.trim(),
  );

  if (!matches || matches.length === 0) return null;

  return matches.find((row) => !excludeId || row.id !== excludeId) ?? null;
}

/**
 * Normalises the optional fields on the input. The Zod schema trims them and
 * accepts `""`; here we collapse the empty form to `null` so the database
 * stores a real NULL instead of an empty string, and the partial-update rule
 * can distinguish "the user cleared the field" from "the user did not touch
 * the field" cleanly.
 */
function normaliseOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Creates one partner for the caller's organization, linking it to the chosen
 * companies (round 10).
 *
 * `input` is `unknown` on purpose: a server action hands over whatever the client
 * sent, and `PartnerSchema.safeParse` below is the boundary that decides whether
 * it is usable. Typing the parameter would only move the cast one layer up.
 */
export async function createPartner(
  input: unknown,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerDetail>> {
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

  const address = normaliseOptionalText(parsed.data.address);
  const taxCode = normaliseOptionalText(parsed.data.taxCode);
  const region = normaliseOptionalText(parsed.data.region);
  const abbreviation = normaliseOptionalText(parsed.data.abbreviation);
  const status = parsed.data.status ?? "active";
  const companyIds = parsed.data.companyIds;

  if (taxCode) {
    const conflict = await findPartnerByTaxCode(taxCode, organizationId);
    if (conflict) {
      return err(
        "validation",
        "Mã số thuế đã được dùng cho đối tác khác trong tổ chức",
        [{ path: "taxCode", message: `Đã thuộc về "${conflict.name}"` }],
      );
    }
  }

  // Every chosen company must belong to the caller's organization, or the
  // junction would link another tenant's company onto this partner.
  const companies = await listCompanies({ organizationId });
  if (!companies.ok) return companies;

  const orgCompanies = companies.data;
  const orgCompanyIds = new Set(orgCompanies.map((company) => company.id));
  const invalidCompany = companyIds.find((id) => !orgCompanyIds.has(id));
  if (invalidCompany) {
    return err("validation", "Công ty được chọn không thuộc tổ chức của bạn");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partners")
    .insert({
      // From the session, never from the request body.
      organization_id: organizationId,
      name: parsed.data.name,
      address,
      tax_code: taxCode,
      region,
      abbreviation,
      status,
    })
    .select(PARTNER_COLUMNS)
    .single();

  if (error) {
    return dbError("createPartner", error);
  }

  const created = data as PartnerRow;

  // Junction — after the partner row exists. On failure, roll the partner back
  // so a half-saved partner (present but linked to no company) cannot survive.
  const { error: junctionError } = await supabase
    .from("partner_companies")
    .insert(companyIds.map((companyId) => ({ partner_id: created.id, company_id: companyId })));

  if (junctionError) {
    await deletePartnerRollback(created.id);
    return dbError("createPartner", junctionError);
  }

  const companyNames = orgCompanies
    .filter((company) => companyIds.includes(company.id))
    .map((company) => company.name)
    .sort();

  // Fire-and-forget: a failed write must never block the create.
  await recordCurrentUserAudit({
    action: "create_partner",
    targetKind: "partner",
    targetId: created.id,
    metadata: {
      name: created.name,
      taxCode: created.tax_code ?? null,
      status,
      companies: companyNames,
    },
  });

  return ok({ ...created, companies: companyNames });
}

/**
 * Renames / re-links an existing partner.
 *
 * Only the keys the caller actually sent are written — same reasoning as
 * `updateContract`: a blind full-row update would clear fields nobody mentioned.
 * When `companyIds` is present the whole junction is replaced (delete + insert);
 * when `status` is present it is written like any other scalar field.
 */
export async function updatePartner(
  id: string,
  input: unknown,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerDetail>> {
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

  const patch: Record<string, string | null> = {};
  if ("name" in raw && parsed.data.name !== undefined) {
    patch.name = parsed.data.name;
  }
  if ("address" in raw) {
    patch.address = normaliseOptionalText(parsed.data.address) ?? null;
  }
  if ("taxCode" in raw) {
    patch.tax_code = normaliseOptionalText(parsed.data.taxCode) ?? null;
  }
  if ("region" in raw) {
    patch.region = normaliseOptionalText(parsed.data.region) ?? null;
  }
  if ("abbreviation" in raw) {
    patch.abbreviation = normaliseOptionalText(parsed.data.abbreviation) ?? null;
  }
  if ("status" in raw && parsed.data.status !== undefined) {
    patch.status = parsed.data.status;
  }

  const hasCompanies = "companyIds" in raw;

  if (Object.keys(patch).length === 0 && !hasCompanies) {
    return err("validation", "Không có thay đổi nào để lưu");
  }

  if ("tax_code" in patch && patch.tax_code) {
    const conflict = await findPartnerByTaxCode(
      patch.tax_code,
      organizationId,
      id,
    );
    if (conflict) {
      return err(
        "validation",
        "Mã số thuế đã được dùng cho đối tác khác trong tổ chức",
        [{ path: "taxCode", message: `Đã thuộc về "${conflict.name}"` }],
      );
    }
  }

  // Resolve the company names once, used both for the junction write and the
  // audit metadata.
  let companyNames: string[] = [];
  let orgCompanyIds = new Set<string>();
  let orgCompanies: Company[] = [];

  if (hasCompanies) {
    const companies = await listCompanies({ organizationId });
    if (!companies.ok) return companies;

    orgCompanies = companies.data;
    orgCompanyIds = new Set(orgCompanies.map((company) => company.id));

    const companyIds = parsed.data.companyIds ?? [];
    const invalidCompany = companyIds.find((id) => !orgCompanyIds.has(id));
    if (invalidCompany) {
      return err("validation", "Công ty được chọn không thuộc tổ chức của bạn");
    }
    companyNames = orgCompanies
      .filter((company) => companyIds.includes(company.id))
      .map((company) => company.name);
  }

  const supabase = await createClient();

  let updated: PartnerRow | null = null;

  if (Object.keys(patch).length > 0) {
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

    updated = data as PartnerRow;
  }

  if (hasCompanies) {
    const { error: deleteError } = await supabase
      .from("partner_companies")
      .delete()
      .eq("partner_id", id);

    if (deleteError) {
      return dbError("updatePartner", deleteError);
    }

    const companyIds = parsed.data.companyIds ?? [];
    if (companyIds.length > 0) {
      const { error: insertError } = await supabase
        .from("partner_companies")
        .insert(companyIds.map((companyId) => ({ partner_id: id, company_id: companyId })));

      if (insertError) {
        return dbError("updatePartner", insertError);
      }
    }
  } else {
    companyNames = await companiesForPartner(id);
  }

  if (!updated) {
    // Only the companies changed; read the partner row for the return value.
    const { data } = await supabase
      .from("partners")
      .select(PARTNER_COLUMNS)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!data) {
      return err("not_found", "Không tìm thấy đối tác");
    }
    updated = data as PartnerRow;
  }

  const changed = Object.keys(patch).map((key) =>
    key === "tax_code" ? "taxCode" : key,
  );
  if (hasCompanies) changed.push("companies");

  await recordCurrentUserAudit({
    action: "update_partner",
    targetKind: "partner",
    targetId: updated.id,
    metadata: {
      name: updated.name,
      changed,
      ...(hasCompanies ? { companies: companyNames.sort() } : {}),
    },
  });

  return ok({ ...updated, companies: companyNames.sort() });
}

/**
 * Round 10 — flips a partner between `active` (đang hợp tác) and `stopped`
 * (đã dừng hợp tác), with a dedicated audit action whose sentence reads
 * "… đã dừng hợp tác với đối tác X" / "… đã khôi phục hợp tác với đối tác X".
 */
export async function setPartnerStatus(
  id: string,
  status: PartnerStatus,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerDetail>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partners")
    .update({ status })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select(PARTNER_COLUMNS)
    .maybeSingle();

  if (error) {
    return dbError("setPartnerStatus", error);
  }

  if (!data) {
    return err("not_found", "Không tìm thấy đối tác");
  }

  const updated = data as PartnerRow;
  const companies = await companiesForPartner(id);

  await recordCurrentUserAudit({
    action: "set_partner_status",
    targetKind: "partner",
    targetId: updated.id,
    metadata: { to: status, name: updated.name },
  });

  return ok({ ...updated, companies });
}

// ---------------------------------------------------------------------------
// Round 7, part 1 — bulk import from Excel
// ---------------------------------------------------------------------------

/** The shape both import functions consume: validated rows, nothing more. */
export type PartnerImportServiceRow = Pick<
  PartnerImportRow,
  | "rowNumber"
  | "name"
  | "address"
  | "taxCode"
  | "region"
  | "abbreviation"
  | "status"
  | "companies"
>;

const IMPORT_DUPLICATE_MESSAGE = (ownerName: string) =>
  `Mã số thuế đã được dùng cho đối tác khác trong tổ chức (Đã thuộc về “${ownerName}”)`;

/**
 * Preview: marks which rows collide with an existing tax code in the database,
 * WITHOUT writing anything.
 *
 * The organization always comes from the caller's session; a tax code that
 * exists in ANOTHER organization is not a conflict, because partners are
 * organization-scoped.
 */
export async function previewPartnerImport(
  rows: PartnerImportServiceRow[],
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerImportRowReport[]>> {
  const existing = await findPartnersByTaxCodes(
    rows.map((row) => row.taxCode),
    organizationId,
  );

  return ok(
    rows.map((row): PartnerImportRowReport => {
      const code = row.taxCode.trim();
      const conflicts = code ? existing.get(code) : undefined;

      if (conflicts && conflicts.length > 0) {
        return {
          rowNumber: row.rowNumber,
          name: row.name,
          address: row.address,
          taxCode: row.taxCode,
          region: row.region,
          abbreviation: row.abbreviation,
          status: row.status,
          companies: row.companies,
          ok: false,
          error: IMPORT_DUPLICATE_MESSAGE(conflicts[0].name),
        };
      }

      return {
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        region: row.region,
        abbreviation: row.abbreviation,
        status: row.status,
        companies: row.companies,
        ok: true,
      };
    }),
  );
}

/**
 * Imports the given validated rows, one by one.
 *
 * One failing row never stops the batch: the per-row result carries its own
 * `ok`/`error`, and the caller reports the summary. Rows whose tax code already
 * exists in the organization are refused BEFORE any insert (same message the
 * preview shows), so a previewed batch does not change meaning between the two
 * steps. Each imported partner is linked to its resolved companies.
 */
export async function importPartners(
  rows: PartnerImportServiceRow[],
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerImportRowReport[]>> {
  const existing = await findPartnersByTaxCodes(
    rows.map((row) => row.taxCode),
    organizationId,
  );

  // The parse already validated names against the known companies; resolve them
  // to database ids here (folded, case-insensitive).
  const companies = await listCompanies({ organizationId });
  if (!companies.ok) return companies;

  const companyIdByName = new Map(
    companies.data.map((company) => [company.name.trim().toLowerCase(), company.id]),
  );

  const supabase = await createClient();
  const results: PartnerImportRowReport[] = [];

  for (const row of rows) {
    const code = row.taxCode.trim();
    const conflicts = code ? existing.get(code) : undefined;

    if (conflicts && conflicts.length > 0) {
      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        region: row.region,
        abbreviation: row.abbreviation,
        status: row.status,
        companies: row.companies,
        ok: false,
        error: IMPORT_DUPLICATE_MESSAGE(conflicts[0].name),
      });
      continue;
    }

    const companyIds = row.companies
      .map((name) => companyIdByName.get(name.trim().toLowerCase()))
      .filter((id): id is string => Boolean(id));

    if (companyIds.length === 0) {
      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        region: row.region,
        abbreviation: row.abbreviation,
        status: row.status,
        companies: row.companies,
        ok: false,
        error: "Không nhận diện được công ty",
      });
      continue;
    }

    try {
      const { data, error } = await supabase
        .from("partners")
        .insert({
          // From the session, never from the request body.
          organization_id: organizationId,
          name: row.name,
          address: row.address.trim() === "" ? null : row.address.trim(),
          tax_code: code === "" ? null : code,
          region: normaliseOptionalText(row.region) ?? null,
          abbreviation: normaliseOptionalText(row.abbreviation) ?? null,
          status: row.status ?? "active",
        })
        .select("id")
        .single();

      if (error || !data) {
        // The raw driver error goes to the server log; the user gets a safe line.
        if (error) console.error("[service:importPartners]", error);
        results.push({
          rowNumber: row.rowNumber,
          name: row.name,
          address: row.address,
          taxCode: row.taxCode,
          region: row.region,
          abbreviation: row.abbreviation,
          status: row.status,
          companies: row.companies,
          ok: false,
          error: "Không thể tạo đối tác này. Vui lòng thử lại.",
        });
        continue;
      }

      const partnerId = (data as { id: string }).id;

      const { error: junctionError } = await supabase
        .from("partner_companies")
        .insert(companyIds.map((companyId) => ({ partner_id: partnerId, company_id: companyId })));

      if (junctionError) {
        await deletePartnerRollback(partnerId);
        results.push({
          rowNumber: row.rowNumber,
          name: row.name,
          address: row.address,
          taxCode: row.taxCode,
          region: row.region,
          abbreviation: row.abbreviation,
          status: row.status,
          companies: row.companies,
          ok: false,
          error: "Không thể tạo đối tác này. Vui lòng thử lại.",
        });
        continue;
      }

      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        region: row.region,
        abbreviation: row.abbreviation,
        status: row.status,
        companies: row.companies,
        ok: true,
        partnerId,
      });
    } catch {
      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        region: row.region,
        abbreviation: row.abbreviation,
        status: row.status,
        companies: row.companies,
        ok: false,
        error: "Không thể tạo đối tác này. Vui lòng thử lại.",
      });
    }
  }

  // One audit row for the whole batch, with the outcome counts.
  if (results.length > 0) {
    const created = results.filter((row) => row.ok).length;
    await recordCurrentUserAudit({
      action: "import_partners",
      targetKind: "partner",
      targetId: null,
      metadata: { created, failed: results.length - created },
    });
  }

  return ok(results);
}

/**
 * Round 19 — hard-delete a partner (owner-only, email-gated).
 *
 * A partner that any contract still references is refused with a clear count —
 * the caller must delete those contracts first (the junction rows cascade on
 * the partner delete, so no extra cleanup is needed). The delete runs through
 * the service-role client; the session has no DELETE grant by hardening.
 */
export async function deletePartner(
  id: string,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return err("unauthenticated", "Bạn cần đăng nhập");
  if (!canDeleteEntities(user.email)) {
    return err("forbidden", "Không có quyền xoá đối tác");
  }

  // A partner in another organization reads as not found — nothing leaks.
  const partner = await getPartner(id, { organizationId });
  if (!partner.ok) return partner;

  const counts = await countContractsByPartner([id], organizationId);
  const count = counts.get(id) ?? 0;
  if (count > 0) {
    return err(
      "validation",
      `Đối tác đang có ${count} hợp đồng, không thể xoá — hãy xoá hợp đồng trước`,
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    return dbError("deletePartner", error);
  }

  // partner_companies rows cascade via the FK (ON DELETE CASCADE).
  const { error } = await admin.from("partners").delete().eq("id", id);
  if (error) {
    return dbError("deletePartner", error);
  }

  await recordCurrentUserAudit({
    action: "delete_partner",
    targetKind: "partner",
    targetId: id,
    metadata: { name: partner.data.name },
  });

  return ok({ id });
}

/**
 * Round 24 — bulk hard-delete of partners (owner-only, email-gated).
 *
 * The permission gate + the per-item logic are the SINGLE `deletePartner` —
 * nothing is copied. Every id resolves independently: a partner that still has
 * contracts is refused (with the count) without stopping the rest of the batch.
 */
export async function deletePartners(
  ids: string[],
  { organizationId }: PartnerContext,
): Promise<ServiceResult<{ results: BulkDeleteItem[] }>> {
  const user = await getCurrentUser();
  if (!user) return err("unauthenticated", "Bạn cần đăng nhập");
  if (!canDeleteEntities(user.email)) {
    return err("forbidden", "Không có quyền xoá đối tác");
  }

  if (ids.length > BULK_DELETE_LIMIT) {
    return err(
      "validation",
      `Chỉ xoá tối đa ${BULK_DELETE_LIMIT} đối tác mỗi lần`,
    );
  }

  const results: BulkDeleteItem[] = [];
  for (const id of ids) {
    const result = await deletePartner(id, { organizationId });
    results.push(
      result.ok ? { id, ok: true } : { id, ok: false, error: result.message },
    );
  }

  return ok({ results });
}