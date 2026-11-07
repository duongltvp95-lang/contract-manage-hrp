import { businessDate } from "@/lib/business-date";
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

function contractWriteError(scope: string, error: unknown): ServiceErr {
  const failure = error as { code?: string; message?: string; details?: string };
  const details = `${failure?.message ?? ""} ${failure?.details ?? ""}`;
  if (failure?.code === "23505" && details.includes("contracts_active_identity_unique")) {
    return err("validation", "Hợp đồng có cùng số, ngày ký và ngày hết hạn đã tồn tại trong hệ thống");
  }
  if (failure?.code === "23514" && details.includes("contracts_expiry_on_or_after_signed_check")) {
    return err("validation", "Ngày hết hạn không được sớm hơn ngày ký hợp đồng");
  }
  if (failure?.code === "23503" && details.includes("contracts_partner_org_fkey")) {
    return err("validation", "Đối tác được chọn không thuộc tổ chức của bạn");
  }
  if (failure?.code === "23503" && details.includes("contracts_company_org_fkey")) {
    return err("validation", "Công ty được chọn không thuộc tổ chức của bạn");
  }
  return dbError(scope, error);
}

export type ContractArchiveState = "active" | "archived" | "missing";

/**
 * Minimal same-org status check via `get_contract_archive_state` RPC.
 * Reveals zero contract fields or file metadata while allowing callers to
 * distinguish an archived contract in their own org from a missing/foreign id.
 */
export async function getContractArchiveState(
  id: string,
): Promise<ContractArchiveState> {
  if (!id || typeof id !== "string") {
    return "missing";
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_contract_archive_state", {
    p_contract_id: id,
  });

  if (error || (data !== "active" && data !== "archived")) {
    return "missing";
  }

  return data;
}

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

  if (error) throw new Error("Không thể kiểm tra hợp đồng trùng", { cause: error });
  if (!data) return null;

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

  if (partnerId) {
    const partner = await getPartner(partnerId, { organizationId });
    if (!partner.ok) {
      return err("validation", "Đối tác được chọn không thuộc tổ chức của bạn");
    }

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

  const signedDate = emptyToNull(values.signedDate);
  const expiryDate = emptyToNull(values.expiryDate);
  if (signedDate && expiryDate && expiryDate < signedDate) {
    return err("validation", "Ngày hết hạn không được sớm hơn ngày ký hợp đồng");
  }

  /**
   * Chặn thêm hợp đồng trùng lặp: nếu số hợp đồng, ngày ký và ngày hết hạn
   * đã tồn tại trong cùng tổ chức thì không cho thêm.
   */
  let duplicate: ContractRow | null;
  try {
    duplicate = await findDuplicateContract({
      contractNumber: values.contractNumber, signedDate: values.signedDate,
      expiryDate: values.expiryDate, organizationId,
    });
  } catch (error) { return dbError("createContract.checkDuplicate", error); }

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
    return contractWriteError("createContract", error);
  }

  const created = data as ContractRow;

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
   * all lists non-archived, both active and expired;
   * expiring (round 49) lists non-archived, expiring within 90 days;
   * no-files (round 49) lists non-archived contracts with zero uploaded files;
   * undated (round 48) lists contracts with no signed date, no expiry date, or indefinite duration.
   */
  scope?: "active" | "expired" | "expiring" | "no-files" | "archived" | "all" | "undated";
}): Promise<ServiceResult<ContractListResult>> {
  const supabase = await createClient();

  // "Today" as YYYY-MM-DD, reused from the preset rule (same definition the
  // dashboard and the expiry presets use — never a second, drifting copy).
  const today = resolveExpiryPreset("expired").lt as string;

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let builder = supabase
    .from("contract_listing")
    .select(`${CONTRACT_COLUMNS}, partner_name, company_name, file_count`, { count: "exact" })
    .eq("organization_id", organizationId);

  if (scope === "archived") {
    builder = builder.not("archived_at", "is", null);
  } else {
    // Archiving is a soft delete (plan section 66): archived rows stay out of
    // both the active and the expired list.
    builder = builder.is("archived_at", null);
    if (scope === "expired") {
      builder = builder.lt("expiry_date", today);
    } else if (scope === "expiring") {
      // Tab "Sắp hết hạn": dùng cùng cửa sổ 90 ngày như dashboard card
      const window = resolveExpiryPreset("expiring90");
      builder = builder.gte("expiry_date", window.gte!).lte("expiry_date", window.lte!);
    } else if (scope === "active") {
      // "Chưa hết hạn" = a future (or missing) expiry date. A contract with no
      // expiry date never expires, so it belongs here rather than disappearing
      // from both tabs.
      builder = builder.or(`expiry_date.is.null,expiry_date.gte.${today}`);
    } else if (scope === "undated") {
      builder = builder.or(
        "signed_date.is.null,expiry_date.is.null,duration_text.ilike.%không xác định%,duration_text.ilike.%vô thời hạn%,duration_text.ilike.%không giới hạn%",
      );
    } else if (scope === "no-files") {
      builder = builder.eq("has_files", false);
    }
    // scope === "all": không lọc theo ngày hết hạn, hiển thị cả đang hoạt động và đã hết hạn
  }

  // Search the joined partner name without truncating a client-side ID set.
  const term = sanitizeSearchTerm(query.q);
  if (term) {
    builder = builder.or(
      `contract_number.ilike.%${term}%,partner_text.ilike.%${term}%,partner_name.ilike.%${term}%`,
    );
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
  // recently expired first); on the expiring tab default sort is "expiry_date asc"
  // (soonest to expire first); an explicit `?sort=` still wins.
  const sortOverridden =
    (scope === "expired" || scope === "expiring") && query.sort === DEFAULT_SORT;
  const sortField = sortOverridden ? "expiry_date" : query.sort;
  const sortAscending = sortOverridden ? scope === "expiring" : query.dir === "asc";

  const { data, count, error } = await builder
    .order(sortField, { ascending: sortAscending, nullsFirst: false })
    .range(from, to);

  if (error) {
    return dbError("listContracts", error);
  }

  const rawRows = (data ?? []) as unknown as (ContractRow & {
    partner_name: string | null; company_name: string | null; file_count: number | string;
  })[];
  const total = count ?? rawRows.length;
  return ok({
    rows: rawRows.map(({ company_name, file_count, ...row }) => ({
      ...row, file_count: Number(file_count), companies: company_name ? [company_name] : [],
    })),
    total, page: query.page, pageSize: query.pageSize,
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
  _organizationId: string,
  action: "update" | "archive",
): Promise<ServiceErr> {
  const state = await getContractArchiveState(id);

  if (state === "archived") {
    return err(
      "forbidden",
      "Hợp đồng đã được lưu trữ nên không thể thay đổi",
    );
  }

  if (state === "missing") {
    return err("not_found", "Không tìm thấy hợp đồng");
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

  if (patch.signed_date && patch.expiry_date && patch.expiry_date < patch.signed_date) {
    return err("validation", "Ngày hết hạn không được sớm hơn ngày ký hợp đồng");
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
    return contractWriteError("updateContract", error);
  }

  if (!data) {
    return explainMissingContract(id, context.organizationId, "update");
  }

  const updated = data as ContractRow;
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
  if (!existing.ok) {
    if (existing.code === "not_found") {
      const archiveState = await getContractArchiveState(id);
      if (archiveState === "archived") {
        return err("forbidden", "Không thể gia hạn hợp đồng đã lưu trữ");
      }
    }
    return existing;
  }
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
    const todayStr = formatDateOnly(businessDate());
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
    return contractWriteError("renewContract", error);
  }

  if (!data) {
    return explainMissingContract(id, context.organizationId, "update");
  }

  const updated = data as ContractRow;

  return ok(updated);
}

export type ArchiveContractResult = {
  id: string;
  archived_at: string;
};

/**
 * Plan sections 66, 76 — archive instead of deleting.
 *
 * Uses `archive_contract_atomic` so non-privileged callers can archive an active
 * contract in their own organization without hitting the `SELECT` RLS restriction
 * on archived rows that `UPDATE ... RETURNING` would trigger.
 */
export async function archiveContract(
  id: string,
  organizationId: string,
): Promise<ServiceResult<ArchiveContractResult>> {
  if (!id || !organizationId) {
    return err("not_found", "Không tìm thấy hợp đồng");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_contract_atomic", {
    p_contract_id: id,
  });

  if (error) {
    return dbError("archiveContract", error);
  }

  const payload = (data ?? {}) as {
    status?: string;
    id?: string;
    archived_at?: string;
  };

  if (payload.status === "already_archived") {
    return err("forbidden", "Hợp đồng đã được lưu trữ nên không thể thay đổi");
  }

  if (payload.status !== "archived" || !payload.id || !payload.archived_at) {
    return err("not_found", "Không tìm thấy hợp đồng");
  }

  return ok({
    id: payload.id,
    archived_at: payload.archived_at,
  });
}

/**
 * Round 19 — hard-delete a contract (privileged archive/delete capability).
 *
 * The delete admin is resolved from the session (`profiles.can_manage_archived`).
 * A service-role RPC deletes the contract and its file rows while adding all R2
 * cleanup intents in one transaction. The scheduled worker removes the private
 * objects after the database commit.
 */
export async function deleteContract(
  id: string,
  { organizationId }: { organizationId: string },
): Promise<ServiceResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return err("unauthenticated", "Bạn cần đăng nhập");
  if (!canDeleteEntities(user)) {
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
  if (!canDeleteEntities(user)) {
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
  if (!canDeleteEntities(user)) {
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
    return contractWriteError("unarchiveContract", error);
  }

  const { data, error } = await admin
    .from("contracts")
    .update({ archived_at: null })
    .eq("id", id)
    .eq("organization_id", user.organizationId)
    .select(CONTRACT_COLUMNS)
    .maybeSingle();

  if (error) {
    return contractWriteError("unarchiveContract", error);
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
