import "server-only";

import {
  CreateContractSchema,
  UpdateContractSchema,
  emptyToNull,
  isRealCalendarDate,
  type CreateContractInput,
  type UpdateContractInput,
} from "@schemas/contract";

import { DEFAULT_SORT, resolveExpiryPreset, sanitizeSearchTerm, type ContractsQuery } from "@/lib/contracts-query";
import { getCurrentUser } from "@/lib/auth";
import { canDeleteEntities, BULK_DELETE_LIMIT } from "@/lib/delete-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/format";
import { recordCurrentUserAudit } from "./audit-logs";
import { getCompany, getPartner } from "./partners";
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
  /** Round 33 — company the contract is signed for; null on pre-round-33 rows. */
  company_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const CONTRACT_COLUMNS =
  "id, organization_id, contract_number, signed_date, duration_text, expiry_date, partner_text, partner_id, company_id, notes, archived_at, created_by, created_at, updated_at";

/**
 * A contract plus the resolved partner name (feature round 2).
 *
 * `partner_name` is null when the contract has no linked partner — which
 * includes every contract created before the partners table existed. Callers
 * fall back to `partner_text` in that case; `partner_text` is never removed.
 */
export type ContractDetail = ContractRow & {
  partner_name: string | null;
  /** Round 33+ — tên công ty ký hợp đồng; null khi `company_id IS NULL`. */
  company_name: string | null;
};

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

export type DuplicateContractCheck = {
  contractNumber?: string | null;
  signedDate?: string | null;
  expiryDate?: string | null;
  organizationId: string;
  excludeContractId?: string;
};

/**
 * Checks if a contract with the same contract_number, signed_date, and expiry_date
 * already exists in the organization (ignoring archived contracts).
 */
export async function findDuplicateContract(
  {
    contractNumber,
    signedDate,
    expiryDate,
    organizationId,
    excludeContractId,
  }: DuplicateContractCheck,
  options?: { abortSignal?: AbortSignal },
): Promise<ContractRow | null> {
  const cleanNumber = emptyToNull(contractNumber);
  if (!cleanNumber) return null;

  const cleanSigned = emptyToNull(signedDate);
  const cleanExpiry = emptyToNull(expiryDate);

  const supabase = await createClient();
  const escapedNumber = cleanNumber.trim().replace(/[%_]/g, "\\$&");

  let query = supabase
    .from("contracts")
    .select(CONTRACT_COLUMNS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .ilike("contract_number", escapedNumber);

  if (options?.abortSignal) {
    query = query.abortSignal(options.abortSignal);
  }

  if (cleanSigned) {
    query = query.eq("signed_date", cleanSigned);
  } else {
    query = query.is("signed_date", null);
  }

  if (cleanExpiry) {
    query = query.eq("expiry_date", cleanExpiry);
  } else {
    query = query.is("expiry_date", null);
  }

  if (excludeContractId) {
    query = query.neq("id", excludeContractId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as ContractRow;
}

/**
 * Looks for an active (unarchived) contract matching a contract number (exact or trimmed ilike)
 * within the organization, resolving partner details.
 */
export async function findBaseContractByNumber(
  {
    contractNumber,
    organizationId,
  }: {
    contractNumber: string;
    organizationId: string;
  },
  options?: { abortSignal?: AbortSignal },
): Promise<{
  id: string;
  contractNumber: string;
  partnerName?: string | null;
  signedDate?: string | null;
  expiryDate?: string | null;
} | null> {
  const cleanNumber = emptyToNull(contractNumber);
  if (!cleanNumber) return null;

  const supabase = await createClient();
  const escapedNumber = cleanNumber.trim().replace(/[%_]/g, "\\$&");

  let query = supabase
    .from("contracts")
    .select("id, contract_number, signed_date, expiry_date, partner_id, partner_text, partners(name)")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .ilike("contract_number", escapedNumber)
    .order("created_at", { ascending: false })
    .limit(1);

  if (options?.abortSignal) {
    query = query.abortSignal(options.abortSignal);
  }

  const { data, error } = await query;
  if (!error && data && data.length > 0) {
    const row = data[0] as unknown as {
      id: string;
      contract_number: string | null;
      signed_date: string | null;
      expiry_date: string | null;
      partner_text: string | null;
      partners?: { name: string } | null;
    };

    return {
      id: row.id,
      contractNumber: row.contract_number ?? cleanNumber,
      partnerName: row.partners?.name || row.partner_text || null,
      signedDate: row.signed_date,
      expiryDate: row.expiry_date,
    };
  }

  // Fallback: nếu ilike trực tiếp không khớp (do khác biệt khoảng trắng quanh dấu / hoặc -),
  // tìm kiếm theo số hợp đồng sau khi chuẩn hóa ký tự
  const normalizedTarget = cleanNumber.replace(/[\s\-_/]/g, "").toLowerCase();
  if (normalizedTarget.length >= 3) {
    let fallbackQuery = supabase
      .from("contracts")
      .select("id, contract_number, signed_date, expiry_date, partner_id, partner_text, partners(name)")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (options?.abortSignal) {
      fallbackQuery = fallbackQuery.abortSignal(options.abortSignal);
    }
    const { data: listData } = await fallbackQuery;
    if (listData && listData.length > 0) {
      const match = listData.find((row) => {
        const num = (row.contract_number || "").replace(/[\s\-_/]/g, "").toLowerCase();
        return num.length > 0 && num === normalizedTarget;
      });
      if (match) {
        const matchedRow = match as unknown as {
          id: string;
          contract_number: string | null;
          signed_date: string | null;
          expiry_date: string | null;
          partner_text: string | null;
          partners?: { name: string } | null;
        };
        return {
          id: matchedRow.id,
          contractNumber: matchedRow.contract_number ?? cleanNumber,
          partnerName: matchedRow.partners?.name || matchedRow.partner_text || null,
          signedDate: matchedRow.signed_date,
          expiryDate: matchedRow.expiry_date,
        };
      }
    }
  }

  return null;
}

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
   * A new contract must name a partner (owner decision, feature round 2).
   *
   * Enforced here as well as in the form because this is the layer an API
   * caller, an import script or a future client cannot bypass. `updateContract`
   * deliberately does NOT require it: contracts created before the partners
   * table exist with free text only, and re-saving one must not force a partner
   * onto it.
   */
  if (!values.partnerId) {
    return err("validation", "Vui lòng chọn đối tác cho hợp đồng");
  }

  /**
   * A chosen partner must belong to the caller's organization.
   *
   * RLS checks the *contract's* organization, not the organization that owns
   * the referenced partner, so without this a crafted request could link a
   * contract to another tenant's partner row — the foreign key would be
   * satisfied and the other tenant's partner name would then render on this
   * contract. The check is explicit for that reason.
   */
  const partnerId = values.partnerId;

  let partnerName: string | null = null;

  if (partnerId) {
    const partner = await getPartner(partnerId, { organizationId });
    if (!partner.ok) {
      return err("validation", "Đối tác được chọn không thuộc tổ chức của bạn");
    }
    partnerName = partner.data.name;
  }

  /**
   * A new contract must name its company (round 33, owner decision).
   *
   * Same reasoning as the partner above, and enforced in the same place: the
   * form asks for it, but this is the layer an API caller, an import script or a
   * future client cannot bypass. `updateContract` deliberately does NOT require
   * it — every contract created before round 33 has `company_id IS NULL`, and
   * re-saving one must not force a company onto it.
   */
  if (!values.companyId) {
    return err("validation", "Vui lòng chọn công ty cho hợp đồng");
  }

  /**
   * A chosen company must belong to the caller's organization — the same IDOR
   * guard as the partner above. RLS checks the *contract's* organization, not
   * the organization that owns the referenced company, so without this an
   * explicit check a crafted request could attach another tenant's company to
   * this contract.
   */
  const companyId = values.companyId;
  const company = await getCompany(companyId, { organizationId });
  if (!company.ok) {
    return err("validation", "Công ty được chọn không thuộc tổ chức của bạn");
  }

  /**
   * Chặn thêm hợp đồng trùng lặp: nếu số hợp đồng, ngày ký và ngày hết hạn
   * đã tồn tại trong cùng tổ chức thì không cho thêm.
   */
  const duplicate = await findDuplicateContract({
    contractNumber: values.contractNumber,
    signedDate: values.signedDate,
    expiryDate: values.expiryDate,
    organizationId,
  });

  if (duplicate) {
    const signedDisplay = duplicate.signed_date ? formatDateOnly(duplicate.signed_date) : "trống";
    const expiryDisplay = duplicate.expiry_date ? formatDateOnly(duplicate.expiry_date) : "trống";
    return err(
      "validation",
      `Hợp đồng số "${duplicate.contract_number}" với ngày ký (${signedDisplay}) và ngày hết hạn (${expiryDisplay}) đã tồn tại trong hệ thống. Vui lòng không thêm trùng lặp.`,
    );
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
      company_id: companyId,
      notes: emptyToNull(values.notes),
    })
    .select(CONTRACT_COLUMNS)
    .single();

  if (error) {
    return dbError("createContract", error);
  }

  const created = data as ContractRow;

  await recordCurrentUserAudit({
    action: "create_contract",
    targetKind: "contract",
    targetId: created.id,
    metadata: {
      contractNumber: created.contract_number ?? null,
      partnerName,
      companyName: company.data.name,
    },
  });

  return ok(created);
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
    .select(`${CONTRACT_COLUMNS}, partners(name), companies(name)`)
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
    companies: { name: string } | { name: string }[] | null;
  };

  const { partners, companies: companiesEmbed, ...rest } = row;
  const embeddedPartner = Array.isArray(partners) ? (partners[0] ?? null) : partners;
  const embeddedCompany = Array.isArray(companiesEmbed)
    ? (companiesEmbed[0] ?? null)
    : companiesEmbed;

  return ok({
    ...rest,
    partner_name: embeddedPartner?.name ?? null,
    company_name: embeddedCompany?.name ?? null,
  });
}

/**
 * A contract plus the file count shown in the "Files" column (plan section 48)
 * and the resolved partner name (feature round 2).
 *
 * `partner_name` is null for a contract with no linked partner — every row
 * created before the partners table existed. The list falls back to
 * `partner_text` in that case.
 */
export type ContractListItem = ContractRow & {
  file_count: number;
  partner_name: string | null;
  /**
   * The company the contract is signed for (round 33 → round 37).
   *
   *   - Round 18: read the partner's `partner_companies` set; showed every
   *     company the partner is linked to, which is misleading for partners
   *     that work with more than one company.
   *   - Round 37: read `contracts.company_id` and embed the company name
   *     through the FK. The array holds 0 or 1 name — 0 when the contract
   *     predates round 33 (`company_id IS NULL`) or when the contract was
   *     created without a company.
   */
  companies: string[];
};

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
 * Giai đoạn 2: Tối ưu đếm số file bằng DB aggregate RPC (security invoker),
 * gom nhóm và tính toán trực tiếp trong Postgres để giảm tải bộ nhớ Node.js.
 * Có fallback an toàn sang truy vấn truyền thống nếu RPC chưa sẵn sàng.
 */
async function countFilesByContract(
  contractIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (contractIds.length === 0) return counts;

  const supabase = await createClient();

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "count_contract_files",
    { contract_ids: contractIds },
  );

  if (!rpcError && rpcData) {
    for (const row of rpcData as { contract_id: string; file_count: number | string }[]) {
      counts.set(row.contract_id, Number(row.file_count) || 0);
    }
    return counts;
  }

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
  scope = "active",
}: {
  organizationId: string;
  query: ContractsQuery;
  /**
   * Round 19/20 — active (default) lists non-archived, not-yet-expired;
   * expired lists non-archived, already-expired; archived lists only archived;
   * all lists non-archived, both active and expired.
   */
  scope?: "active" | "expired" | "archived" | "all";
}): Promise<ServiceResult<ContractListResult>> {
  const supabase = await createClient();

  // "Today" as YYYY-MM-DD, reused from the preset rule (same definition the
  // dashboard and the expiry presets use — never a second, drifting copy).
  const today = resolveExpiryPreset("expired").lt as string;

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let builder = supabase
    .from("contracts")
    // Round 37 — the "Công ty" column on the contract list shows the company
    // the contract is signed for (contracts.company_id), NOT every company the
    // partner is linked to via partner_companies. Before this fix, a merged
    // partner (e.g. DONGYANG after round 35) showed the full partner_companies
    // set on every one of its contracts, which was misleading. The embed
    // `companies!contracts_company_id_fkey(name)` reads the company through the
    // many-to-one FK set up in round 33, and is the only writer for this column.
    .select(`${CONTRACT_COLUMNS}, partners(name), companies!contracts_company_id_fkey(name)`, { count: "exact" })
    .eq("organization_id", organizationId);

  if (scope === "archived") {
    builder = builder.not("archived_at", "is", null);
  } else {
    // Archiving is a soft delete (plan section 66): archived rows stay out of
    // both the active and the expired list.
    builder = builder.is("archived_at", null);
    if (scope === "expired") {
      builder = builder.lt("expiry_date", today);
    } else if (scope === "active") {
      // "Chưa hết hạn" = a future (or missing) expiry date. A contract with no
      // expiry date never expires, so it belongs here rather than disappearing
      // from both tabs.
      builder = builder.or(`expiry_date.is.null,expiry_date.gte.${today}`);
    }
    // scope === "all": không lọc theo ngày hết hạn, hiển thị cả đang hoạt động và đã hết hạn
  }

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
  // Round 20: on the expired tab the default sort is "expiry_date desc" (most
  // recently expired first); an explicit `?sort=` still wins.
  const sortOverridden = scope === "expired" && query.sort === DEFAULT_SORT;
  const sortField = sortOverridden ? "expiry_date" : query.sort;
  const sortAscending = sortOverridden ? false : query.dir === "asc";

  const { data, count, error } = await builder
    .order(sortField, { ascending: sortAscending, nullsFirst: false })
    .range(from, to);

  if (error) {
    return dbError("listContracts", error);
  }

  const rawRows = (data ?? []) as unknown as (ContractRow & {
    partners: { name: string } | { name: string }[] | null;
    companies: { name: string } | { name: string }[] | null;
  })[];
  const fileCounts = await countFilesByContract(rawRows.map((row) => row.id));
  const total = count ?? rawRows.length;

  return ok({
    rows: rawRows.map(({ partners, companies: companiesEmbed, ...row }) => {
      // A many-to-one embed arrives as an object; the generated types cannot
      // tell it apart from a to-many embed, so both shapes are accepted.
      const embeddedPartner = Array.isArray(partners)
        ? (partners[0] ?? null)
        : partners;
      const embeddedCompany = Array.isArray(companiesEmbed)
        ? (companiesEmbed[0] ?? null)
        : companiesEmbed;

      return {
        ...row,
        file_count: fileCounts.get(row.id) ?? 0,
        partner_name: embeddedPartner?.name ?? null,
        // Round 37 — the company shown on the contract is the company the
        // contract is signed for (`contracts.company_id`), not the partner's
        // full company set. Pre-round-33 contracts (company_id IS NULL) get an
        // empty array, which the UI renders as no badge — same as today, just
        // for the right reason now.
        companies: embeddedCompany?.name ? [embeddedCompany.name] : [],
      };
    }),
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
  if ("contractNumber" in raw) {
    const nextNum = emptyToNull(values.contractNumber);
    if (!nextNum || nextNum.trim() === "—") {
      const supabase = await createClient();
      const { data: appendix, error: appendixError } = await supabase
        .from("contract_files")
        .select("id")
        .eq("organization_id", context.organizationId)
        .eq("contract_id", id)
        .eq("kind", "appendix")
        .limit(1)
        .maybeSingle();

      if (appendixError) {
        return dbError("updateContract.checkAppendices", appendixError);
      }

      if (appendix) {
        return err(
          "validation",
          "Không thể xóa số hợp đồng khi hồ sơ đã có phụ lục đính kèm.",
        );
      }
    }
    patch.contract_number = nextNum;
  }
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

  /**
   * The company link, only when the caller sent the key (round 33).
   *
   * `""` clears the link (a pre-round-33 contract keeps staying editable), a
   * uuid sets it — and, as in `createContract`, the company must belong to the
   * caller's organization, or this would attach another tenant's company to a
   * contract.
   *
   * NOT required here: the owner decision is "bắt buộc khi tạo, không bắt buộc
   * khi sửa", so an edit that leaves the field empty is legal.
   */
  if ("companyId" in raw) {
    const companyId = values.companyId ? values.companyId : null;

    if (companyId) {
      const company = await getCompany(companyId, {
        organizationId: context.organizationId,
      });
      if (!company.ok) {
        return err("validation", "Công ty được chọn không thuộc tổ chức của bạn");
      }
    }

    patch.company_id = companyId;
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

  const updated = data as ContractRow;
  const FIELD_LABELS: Record<string, string> = {
    contract_number: "contractNumber",
    signed_date: "signedDate",
    duration_text: "durationText",
    expiry_date: "expiryDate",
    partner_text: "partnerText",
    partner_id: "partnerId",
    company_id: "companyId",
    notes: "notes",
  };
  const changed = Object.keys(patch).map((key) => FIELD_LABELS[key] ?? key);

  await recordCurrentUserAudit({
    action: "update_contract",
    targetKind: "contract",
    targetId: updated.id,
    metadata: { contractNumber: updated.contract_number ?? null, changed },
  });

  return ok(updated);
}

export type RenewContractServiceInput = {
  newExpiryDate: string;
  newDurationText?: string | null;
  renewalNote?: string | null;
};

/**
 * Manually renew an existing contract with a new expiry date, duration, and renewal note.
 */
export async function renewContract(
  id: string,
  input: RenewContractServiceInput,
  context: CreateContractContext,
): Promise<ServiceResult<ContractRow>> {
  if (!id || typeof id !== "string") {
    return err("validation", "Thiếu ID hợp đồng");
  }

  const newExpiry = (input.newExpiryDate ?? "").trim();
  if (!newExpiry || !isRealCalendarDate(newExpiry)) {
    return err(
      "validation",
      "Ngày hết hạn mới phải theo định dạng YYYY-MM-DD và là ngày hợp lệ",
    );
  }

  // 1. Kiểm tra hợp đồng tồn tại và thuộc tổ chức
  const existing = await getContract(id, context.organizationId);
  if (!existing.ok) return existing;
  const currentContract = existing.data;

  if (currentContract.archived_at) {
    return err("forbidden", "Không thể gia hạn hợp đồng đã lưu trữ");
  }

  // Kiểm tra ngày hết hạn mới không được trước ngày ký hợp đồng
  if (currentContract.signed_date && newExpiry < currentContract.signed_date) {
    return err(
      "validation",
      `Ngày hết hạn mới (${formatDateOnly(newExpiry)}) không thể trước ngày ký hợp đồng (${formatDateOnly(currentContract.signed_date)})`,
    );
  }

  // 2. Chuẩn bị ghi chú nối thêm nếu có
  let updatedNotes = currentContract.notes ?? "";
  if (input.renewalNote && input.renewalNote.trim()) {
    const todayStr = formatDateOnly(new Date().toISOString().slice(0, 10));
    const renewalEntry = `[Gia hạn ${todayStr}: Hạn mới ${formatDateOnly(newExpiry)}] ${input.renewalNote.trim()}`;
    updatedNotes = updatedNotes.trim()
      ? `${updatedNotes.trim()}\n${renewalEntry}`
      : renewalEntry;
  }

  // 3. Cập nhật hợp đồng
  const patch: Record<string, string | null> = {
    expiry_date: newExpiry,
  };
  if (input.newDurationText !== undefined) {
    patch.duration_text = emptyToNull(input.newDurationText);
  }
  if (input.renewalNote && input.renewalNote.trim()) {
    patch.notes = emptyToNull(updatedNotes);
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
    return dbError("renewContract", error);
  }

  if (!data) {
    return explainMissingContract(id, context.organizationId, "update");
  }

  const updated = data as ContractRow;

  await recordCurrentUserAudit({
    action: "update_contract",
    targetKind: "contract",
    targetId: updated.id,
    metadata: {
      action_subtype: "renew_contract",
      contractNumber: updated.contract_number ?? null,
      previousExpiryDate: currentContract.expiry_date,
      newExpiryDate: newExpiry,
    },
  });

  return ok(updated);
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

  const archived = data as ContractRow;

  await recordCurrentUserAudit({
    action: "archive_contract",
    targetKind: "contract",
    targetId: archived.id,
    metadata: { contractNumber: archived.contract_number ?? null },
  });

  return ok(archived);
}

/**
 * Round 19 — hard-delete a contract (owner-only, email-gated).
 *
 * The delete admin is resolved from the session and must match
 * `DELETE_ADMIN_EMAILS`. A service-role RPC deletes the contract and its file
 * rows while adding all R2 cleanup intents in one transaction. The scheduled
 * worker removes the private objects after the database commit.
 */
export async function deleteContract(
  id: string,
  { organizationId }: { organizationId: string },
): Promise<ServiceResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return err("unauthenticated", "Bạn cần đăng nhập");
  if (!canDeleteEntities(user.email)) {
    return err("forbidden", "Không có quyền xoá hợp đồng");
  }

  // A contract in another organization reads as not found — nothing leaks.
  const contract = await getContract(id, organizationId);
  if (!contract.ok) return contract;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    return dbError("deleteContract", error);
  }

  const { data: deleted, error: deleteError } = await admin
    .rpc("delete_contract_with_r2_cleanup", {
      p_contract_id: id,
      p_organization_id: organizationId,
    })
    .abortSignal(AbortSignal.timeout(5_000));

  if (deleteError) return dbError("deleteContract", deleteError);
  if (!deleted) return err("not_found", "Hợp đồng đã được xoá hoặc không còn tồn tại");

  await recordCurrentUserAudit({
    action: "delete_contract",
    targetKind: "contract",
    targetId: id,
    metadata: {
      contractNumber: contract.data.contract_number ?? null,
      ...(contract.data.partner_name
        ? { partnerName: contract.data.partner_name }
        : {}),
    },
  });

  return ok({ id });
}

/** Round 24 — one per-item result of a bulk delete. */
export type BulkDeleteItem = {
  id: string;
  ok: boolean;
  /** The readable reason when `ok` is false (e.g. "Không tìm thấy hợp đồng"). */
  error?: string;
};

/**
 * Round 24 — bulk hard-delete of contracts (owner-only, email-gated).
 *
 * The permission gate + the per-item logic are the SINGLE `deleteContract` —
 * nothing is copied. Every id resolves independently: one failure (another
 * organization, missing, R2 outage) never blocks the rest of the batch.
 */
export async function deleteContracts(
  ids: string[],
  { organizationId }: { organizationId: string },
): Promise<ServiceResult<{ results: BulkDeleteItem[] }>> {
  const user = await getCurrentUser();
  if (!user) return err("unauthenticated", "Bạn cần đăng nhập");
  if (!canDeleteEntities(user.email)) {
    return err("forbidden", "Không có quyền xoá hợp đồng");
  }

  if (ids.length > BULK_DELETE_LIMIT) {
    return err(
      "validation",
      `Chỉ xoá tối đa ${BULK_DELETE_LIMIT} hợp đồng mỗi lần`,
    );
  }

  const results: BulkDeleteItem[] = [];
  for (const id of ids) {
    const result = await deleteContract(id, { organizationId });
    results.push(
      result.ok ? { id, ok: true } : { id, ok: false, error: result.message },
    );
  }

  return ok({ results });
}

/**
 * Round 19, part 2 — unarchive a contract (owner-only, email-gated).
 *
 * Mirrors `archiveContract` with the inverse guard: the update only matches a
 * row that IS archived, so unarchiving an active contract is a clear error
 * rather than a silent no-op.
 */
export async function unarchiveContract(id: string): Promise<ServiceResult<ContractRow>> {
  const user = await getCurrentUser();
  if (!user) return err("unauthenticated", "Bạn cần đăng nhập");
  if (!canDeleteEntities(user.email)) {
    return err("forbidden", "Không có quyền bỏ lưu trữ hợp đồng");
  }

  // Org check — a contract in another organization reads as not found.
  const contract = await getContract(id, user.organizationId);
  if (!contract.ok) return contract;

  // The guard: only a currently-archived contract may be unarchived.
  if (contract.data.archived_at === null) {
    return err("validation", "Hợp đồng chưa được lưu trữ nên không thể bỏ lưu trữ");
  }

  // The RLS UPDATE policy freezes archived contracts (`using … archived_at is
  // null`), so the unarchive — which must UNFREEZE — runs through the
  // service-role client. The org + archived guards above already authorized it.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    return dbError("unarchiveContract", error);
  }

  const { data, error } = await admin
    .from("contracts")
    .update({ archived_at: null })
    .eq("id", id)
    .eq("organization_id", user.organizationId)
    .select(CONTRACT_COLUMNS)
    .maybeSingle();

  if (error) {
    return dbError("unarchiveContract", error);
  }

  if (!data) {
    return err("not_found", "Không tìm thấy hợp đồng");
  }

  const unarchived = data as ContractRow;

  await recordCurrentUserAudit({
    action: "unarchive_contract",
    targetKind: "contract",
    targetId: id,
    metadata: { contractNumber: unarchived.contract_number ?? null },
  });

  return ok(unarchived);
}
