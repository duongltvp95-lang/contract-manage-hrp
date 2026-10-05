import "server-only";

import {
  CreateContractSchema,
  UpdateContractSchema,
  emptyToNull,
  type CreateContractInput,
  type UpdateContractInput,
} from "@schemas/contract";

import { resolveExpiryPreset, sanitizeSearchTerm, type ContractsQuery } from "@/lib/contracts-query";
import { createClient } from "@/lib/supabase/server";
import { getPartner } from "./partners";
import { dbError, err, ok, type ServiceErr, type ServiceResult } from "./types";

/**
 * Contract service — plan sections 75, 76.
 *
 * Every function takes `organizationId` from the caller's session
 * (`resolveAccess()`); the client never supplies it. RLS enforces the same rule
 * at the database level, so this is a second, explicit line of defence.
 */

export type ContractRow = {
  id: string;
  organization_id: string;
  contract_number: string | null;
  signed_date: string | null;
  duration_text: string | null;
  expiry_date: string | null;
  partner_text: string | null;
  partner_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const CONTRACT_COLUMNS =
  "id, organization_id, contract_number, signed_date, duration_text, expiry_date, partner_text, partner_id, notes, archived_at, created_by, created_at, updated_at";

/**
 * A contract plus the resolved partner name (feature round 2).
 *
 * `partner_name` is null when the contract has no linked partner — which
 * includes every contract created before the partners table existed. Callers
 * fall back to `partner_text` in that case; `partner_text` is never removed.
 */
export type ContractDetail = ContractRow & { partner_name: string | null };

/**
 * How many matching partner ids may be folded into the search filter.
 *
 * The directory is expected to be small (tens, maybe low hundreds), so this
 * bound is not reached in practice — it exists so that a pathological term
 * ("a") cannot build a URL longer than the server accepts. When it is reached
 * the search still works; it simply covers the first N matching partners.
 */
const PARTNER_SEARCH_ID_LIMIT = 150;

export type CreateContractContext = {
  userId: string;
  organizationId: string;
};

/** Plan sections 31, 45 — inserts one contract for the caller's organization. */
export async function createContract(
  input: CreateContractInput,
  { userId, organizationId }: CreateContractContext,
): Promise<ServiceResult<ContractRow>> {
  const parsed = CreateContractSchema.safeParse(input);

  if (!parsed.success) {
    return err(
      "validation",
      "Dữ liệu hợp đồng không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const values = parsed.data;

  /**
   * A chosen partner must belong to the caller's organization.
   *
   * RLS checks the *contract's* organization, not the organization that owns
   * the referenced partner, so without this a crafted request could link a
   * contract to another tenant's partner row — the foreign key would be
   * satisfied and the other tenant's partner name would then render on this
   * contract. The check is explicit for that reason.
   */
  const partnerId = values.partnerId ? values.partnerId : null;

  if (partnerId) {
    const partner = await getPartner(partnerId, { organizationId });
    if (!partner.ok) {
      return err("validation", "Đối tác được chọn không thuộc tổ chức của bạn");
    }
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .insert({
      // Both ids come from the server session, never from the request body.
      organization_id: organizationId,
      created_by: userId,
      contract_number: emptyToNull(values.contractNumber),
      signed_date: emptyToNull(values.signedDate),
      duration_text: emptyToNull(values.durationText),
      expiry_date: emptyToNull(values.expiryDate),
      partner_text: emptyToNull(values.partnerText),
      partner_id: partnerId,
      notes: emptyToNull(values.notes),
    })
    .select(CONTRACT_COLUMNS)
    .single();

  if (error) {
    return dbError("createContract", error);
  }

  return ok(data as ContractRow);
}

/**
 * Returns the contract only when it belongs to `organizationId`, with the linked
 * partner's name resolved (feature round 2).
 *
 * The embed is a left join: `partners(name)` yields `null` for a contract with
 * no `partner_id`, which is every pre-round-2 row. Callers show `partner_name`
 * when it exists and fall back to `partner_text`.
 */
export async function getContract(
  id: string,
  organizationId: string,
): Promise<ServiceResult<ContractDetail>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(`${CONTRACT_COLUMNS}, partners(name)`)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return dbError("getContract", error);
  }

  if (!data) {
    // Either it does not exist or it belongs to another organization. Answering
    // the same way for both avoids leaking the existence of other tenants' data.
    return err("not_found", "Không tìm thấy hợp đồng");
  }

  // A many-to-one embed (`contracts.partner_id -> partners.id`) comes back as a
  // single object at runtime, but the generated PostgREST types cannot tell it
  // apart from a to-many embed and declare an array. Both shapes are accepted so
  // the code is correct whichever the client hands over.
  const row = data as unknown as ContractRow & {
    partners: { name: string } | { name: string }[] | null;
  };

  const { partners, ...contract } = row;
  const embedded = Array.isArray(partners) ? (partners[0] ?? null) : partners;

  return ok({
    ...contract,
    partner_name: embedded?.name ?? null,
  });
}

/** A contract plus the file count shown in the "Files" column (plan section 48). */
export type ContractListItem = ContractRow & { file_count: number };

export type ContractListResult = {
  rows: ContractListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/**
 * Counts files per contract for one page of rows.
 *
 * Done as a single extra query rather than a PostgREST embedded count so the
 * shape stays explicit and RLS applies exactly once per row.
 */
async function countFilesByContract(
  contractIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (contractIds.length === 0) return counts;

  const supabase = await createClient();
  const { data } = await supabase
    .from("contract_files")
    .select("contract_id")
    .in("contract_id", contractIds);

  for (const row of (data ?? []) as { contract_id: string }[]) {
    counts.set(row.contract_id, (counts.get(row.contract_id) ?? 0) + 1);
  }

  return counts;
}

/**
 * Server-side list with search, filters, sorting and pagination
 * (plan sections 48-53).
 *
 * Everything is pushed into SQL: the page never receives more than `pageSize`
 * rows, and `count: "exact"` supplies the total for the pagination controls.
 *
 * `organizationId` must come from the session — the caller passes it, never the
 * client.
 */
export async function listContracts({
  organizationId,
  query,
}: {
  organizationId: string;
  query: ContractsQuery;
}): Promise<ServiceResult<ContractListResult>> {
  const supabase = await createClient();

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let builder = supabase
    .from("contracts")
    .select(CONTRACT_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId)
    // Archiving is a soft delete (plan section 66): archived rows stay out of
    // the Wave 1 list.
    .is("archived_at", null);

  // --- search (plan sections 50, 51; feature round 2 adds the partner link) --
  // Three sources, OR'd: the contract number, the free-text partner name that
  // every pre-round-2 row carries, and the name of the partner the contract is
  // now linked to.
  //
  // The linked-name case is resolved as a set of partner ids rather than as a
  // join inside the filter. PostgREST cannot OR a column of an embedded
  // resource with a column of the base table in one `or`, and folding the
  // matching contract ids in instead would put an unbounded list in the URL.
  // The partner directory is small by design (`listPartners` returns all of it
  // for the filter controls), so a `partner_id.in.(…)` list stays short.
  const term = sanitizeSearchTerm(query.q);
  if (term) {
    const { data: matchingPartners, error: partnerSearchError } = await supabase
      .from("partners")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", `%${term}%`)
      .limit(PARTNER_SEARCH_ID_LIMIT);

    if (partnerSearchError) {
      return dbError("listContracts", partnerSearchError);
    }

    const clauses = [
      `contract_number.ilike.%${term}%`,
      `partner_text.ilike.%${term}%`,
    ];

    const partnerIds = (matchingPartners ?? []).map((row) => row.id);

    if (partnerIds.length > 0) {
      clauses.push(`partner_id.in.(${partnerIds.join(",")})`);
    }

    builder = builder.or(clauses.join(","));
  }

  // --- partner filter (feature round 2) ------------------------------------
  if (query.partnerId) {
    builder = builder.eq("partner_id", query.partnerId);
  }

  // --- date filters (plan section 52) --------------------------------------
  if (query.signedFrom) builder = builder.gte("signed_date", query.signedFrom);
  if (query.signedTo) builder = builder.lte("signed_date", query.signedTo);

  // A preset wins over the manual expiry range: they answer the same question.
  const preset = query.preset ? resolveExpiryPreset(query.preset) : {};
  const expiryGte = preset.gte ?? query.expiryFrom ?? "";
  const expiryLte = preset.lte ?? query.expiryTo ?? "";

  if (expiryGte) builder = builder.gte("expiry_date", expiryGte);
  if (expiryLte) builder = builder.lte("expiry_date", expiryLte);
  if (preset.lt) builder = builder.lt("expiry_date", preset.lt);

  // --- sort + pagination ---------------------------------------------------
  const { data, count, error } = await builder
    .order(query.sort, { ascending: query.dir === "asc", nullsFirst: false })
    .range(from, to);

  if (error) {
    return dbError("listContracts", error);
  }

  const rows = (data ?? []) as ContractRow[];
  const fileCounts = await countFilesByContract(rows.map((row) => row.id));
  const total = count ?? rows.length;

  return ok({
    rows: rows.map((row) => ({
      ...row,
      file_count: fileCounts.get(row.id) ?? 0,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  });
}

/**
 * Turns "the write matched no row" into the right message.
 *
 * Both writes deliberately carry `.is("archived_at", null)`, so by their result
 * alone an archived contract is indistinguishable from a missing one. One extra
 * read on the failure path tells the user which it was — and a contract in
 * another organization is reported exactly like a missing one, so nothing leaks.
 */
async function explainMissingContract(
  id: string,
  organizationId: string,
  action: "update" | "archive",
): Promise<ServiceErr> {
  const existing = await getContract(id, organizationId);

  if (!existing.ok) {
    return err("not_found", "Không tìm thấy hợp đồng");
  }

  if (existing.data.archived_at) {
    return err(
      "forbidden",
      "Hợp đồng đã được lưu trữ nên không thể thay đổi",
    );
  }

  return err(
    "db_error",
    action === "update"
      ? "Không cập nhật được hợp đồng. Vui lòng thử lại."
      : "Không lưu trữ được hợp đồng. Vui lòng thử lại.",
  );
}

/**
 * Plan sections 65, 76 — edit an existing contract.
 *
 * `organizationId` comes from the session (never the request), and is applied
 * both as an explicit filter and through RLS. `.is("archived_at", null)` freezes
 * archived contracts: the list already hides them, so accepting an edit would
 * change a record the user cannot see.
 *
 * `context.userId` is accepted for symmetry with `createContract` but not used:
 * `updated_at` is maintained by the database trigger, not by the caller.
 */
export async function updateContract(
  id: string,
  input: UpdateContractInput,
  context: CreateContractContext,
): Promise<ServiceResult<ContractRow>> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const parsed = UpdateContractSchema.safeParse(raw);

  if (!parsed.success) {
    return err(
      "validation",
      "Dữ liệu hợp đồng không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const values = parsed.data;

  /**
   * Only the keys the caller actually sent are written.
   *
   * Every field in `UpdateContractSchema` is optional, so `{ notes: "" }` is
   * valid input. A blind full-row update would then NULL every column the caller
   * never mentioned — silently destroying data. An update must not touch what it
   * was not asked to change; an explicit `""` still clears its own field, which
   * is how a user empties a value in the form.
   *
   * The edit form always submits every field (React Hook Form returns the whole
   * values object), so in the UI this is a full update either way.
   */
  const patch: Record<string, string | null> = {};
  if ("contractNumber" in raw) patch.contract_number = emptyToNull(values.contractNumber);
  if ("signedDate" in raw) patch.signed_date = emptyToNull(values.signedDate);
  if ("durationText" in raw) patch.duration_text = emptyToNull(values.durationText);
  if ("expiryDate" in raw) patch.expiry_date = emptyToNull(values.expiryDate);
  if ("partnerText" in raw) patch.partner_text = emptyToNull(values.partnerText);
  if ("notes" in raw) patch.notes = emptyToNull(values.notes);

  /**
   * The partner link, only when the caller sent the key.
   *
   * `""` clears the link (back to free text), a uuid sets it — and, as in
   * `createContract`, the partner must belong to the caller's organization, or
   * this would be a way to attach another tenant's partner to a contract.
   */
  if ("partnerId" in raw) {
    const partnerId = values.partnerId ? values.partnerId : null;

    if (partnerId) {
      const partner = await getPartner(partnerId, {
        organizationId: context.organizationId,
      });
      if (!partner.ok) {
        return err("validation", "Đối tác được chọn không thuộc tổ chức của bạn");
      }
    }

    patch.partner_id = partnerId;
  }

  if (Object.keys(patch).length === 0) {
    return err("validation", "Không có thay đổi nào để lưu");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .select(CONTRACT_COLUMNS)
    .maybeSingle();

  if (error) {
    return dbError("updateContract", error);
  }

  if (!data) {
    return explainMissingContract(id, context.organizationId, "update");
  }

  return ok(data as ContractRow);
}

/**
 * Plan sections 66, 76 — archive instead of deleting.
 *
 * Soft delete only: `archived_at` is stamped and the row stays. There is no hard
 * delete path in the Wave 1 UI, and no unarchive UI either — both are owner
 * decisions for M7.
 */
export async function archiveContract(
  id: string,
  organizationId: string,
): Promise<ServiceResult<ContractRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organizationId)
    // Makes a repeated archive a no-op rather than moving the timestamp, which
    // keeps "when was this archived?" meaningful.
    .is("archived_at", null)
    .select(CONTRACT_COLUMNS)
    .maybeSingle();

  if (error) {
    return dbError("archiveContract", error);
  }

  if (!data) {
    return explainMissingContract(id, organizationId, "archive");
  }

  return ok(data as ContractRow);
}
