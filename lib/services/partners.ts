import "server-only";

import { PartnerSchema, UpdatePartnerSchema } from "@schemas/partner";

import type { PartnerImportRow, PartnerImportRowReport } from "@/lib/partner-import";
import { createClient } from "@/lib/supabase/server";
import { PARTNER_SEARCH_LIMIT } from "@/lib/partner-display";
import { recordCurrentUserAudit } from "./audit-logs";
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
  created_at: string;
  updated_at: string;
};

export const PARTNER_COLUMNS =
  "id, organization_id, name, address, tax_code, created_at, updated_at";

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

  const address = normaliseOptionalText(parsed.data.address);
  const taxCode = normaliseOptionalText(parsed.data.taxCode);

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

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partners")
    .insert({
      // From the session, never from the request body.
      organization_id: organizationId,
      name: parsed.data.name,
      address,
      tax_code: taxCode,
    })
    .select(PARTNER_COLUMNS)
    .single();

  if (error) {
    return dbError("createPartner", error);
  }

  const created = data as PartnerRow;

  // Fire-and-forget: a failed write must never block the create.
  await recordCurrentUserAudit({
    action: "create_partner",
    targetKind: "partner",
    targetId: created.id,
    metadata: { name: created.name, taxCode: created.tax_code ?? null },
  });

  return ok(created);
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

  if (Object.keys(patch).length === 0) {
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

  const updated = data as PartnerRow;
  const changed = Object.keys(patch).map((key) =>
    key === "tax_code" ? "taxCode" : key,
  );

  await recordCurrentUserAudit({
    action: "update_partner",
    targetKind: "partner",
    targetId: updated.id,
    metadata: { name: updated.name, changed },
  });

  return ok(updated);
}

// ---------------------------------------------------------------------------
// Round 7, part 1 — bulk import from Excel
// ---------------------------------------------------------------------------

/** The shape both import functions consume: validated rows, nothing more. */
export type PartnerImportServiceRow = Pick<
  PartnerImportRow,
  "rowNumber" | "name" | "address" | "taxCode"
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
          ok: false,
          error: IMPORT_DUPLICATE_MESSAGE(conflicts[0].name),
        };
      }

      return {
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
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
 * steps.
 */
export async function importPartners(
  rows: PartnerImportServiceRow[],
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerImportRowReport[]>> {
  const existing = await findPartnersByTaxCodes(
    rows.map((row) => row.taxCode),
    organizationId,
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
        ok: false,
        error: IMPORT_DUPLICATE_MESSAGE(conflicts[0].name),
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
        })
        .select("id")
        .single();

      if (error) {
        // The raw driver error goes to the server log; the user gets a safe line.
        console.error("[service:importPartners]", error);
        results.push({
          rowNumber: row.rowNumber,
          name: row.name,
          address: row.address,
          taxCode: row.taxCode,
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
        ok: true,
        partnerId: (data as { id: string } | null)?.id,
      });
    } catch {
      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
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