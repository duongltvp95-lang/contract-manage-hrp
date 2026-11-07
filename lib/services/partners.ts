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
import {
  PARTNERS_PAGE_SIZE_DEFAULT,
  PARTNER_SEARCH_LIMIT,
  foldText,
} from "@/lib/partner-display";
import {
  buildMergePatch,
  matchExistingPartner,
  mergeDirectoryEntry,
  type MergeablePartner,
  type MergeIncoming,
} from "@/lib/partner-merge";
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
 * Round 19 & 24 introduced `deletePartner()` and bulk `deletePartners()`, which
 * are strictly restricted to the Owner (`canDeleteEntities()`). Deleting a partner
 * requires that all referenced contracts are deleted first.
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

export { PARTNERS_PAGE_SIZE_DEFAULT };
export const PARTNERS_PAGE_SIZE_MAX = 500;
export const PARTNERS_BATCH_SIZE = 1_000;
const PARTNER_ID_IN_CHUNK_SIZE = 200;

export type PartnersDirectoryPage = {
  rows: PartnerWithCount[];
  totalCount: number;
  page: number;
  pageSize: number;
  pageCount: number;
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

  for (let start = 0; start < partnerIds.length; start += PARTNER_ID_IN_CHUNK_SIZE) {
    const chunk = partnerIds.slice(start, start + PARTNER_ID_IN_CHUNK_SIZE);
    for (let offset = 0; ; offset += PARTNERS_BATCH_SIZE) {
      const baseQuery = supabase
        .from("contracts")
        .select("id, partner_id")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .in("partner_id", chunk)
        .order("id", { ascending: true });

      const supportsRange = typeof baseQuery.range === "function";
      const { data } = supportsRange
        ? await baseQuery.range(offset, offset + PARTNERS_BATCH_SIZE - 1)
        : await baseQuery;

      const rows = (data ?? []) as { id?: string; partner_id: string | null }[];
      for (const row of rows) {
        if (!row.partner_id) continue;
        counts.set(row.partner_id, (counts.get(row.partner_id) ?? 0) + 1);
      }

      if (!supportsRange || rows.length < PARTNERS_BATCH_SIZE) {
        break;
      }
    }
  }

  return counts;
}

/**
 * The companies of the caller's organization (round 10). Small by design — the
 * seed is two rows — so this returns the whole list for the form and the import.
 */
export async function listCompanies(
  { organizationId }: PartnerContext,
  options?: { abortSignal?: AbortSignal },
): Promise<ServiceResult<Company[]>> {
  const supabase = await createClient(options);

  let query = supabase
    .from("companies")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (options?.abortSignal) {
    query = query.abortSignal(options.abortSignal);
  }

  try {
    const { data, error } = await query;
    if (error) {
      if (options?.abortSignal?.aborted) {
        return err("db_error", "Yêu cầu danh sách công ty đã bị hủy do quá thời gian");
      }
      return dbError("listCompanies", error);
    }
    return ok((data ?? []) as Company[]);
  } catch (error) {
    if (options?.abortSignal?.aborted) {
      return err("db_error", "Yêu cầu danh sách công ty đã bị hủy do quá thời gian");
    }
    return dbError("listCompanies", error);
  }
}

/**
 * One company of the caller's organization (round 33).
 *
 * The single-id variant of `listCompanies`, used to validate the company a
 * contract is signed for. Deliberately NOT implemented as
 * `listCompanies(...).then(find)` — that would read the whole (tiny) list on
 * every create and every update when one indexed lookup answers the question.
 * Same answer as `getPartner`: a company of another organization reads as "not
 * found", so nothing about the other tenant leaks.
 */
export async function getCompany(
  id: string,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<Company>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return dbError("getCompany", error);
  }

  if (!data) {
    return err("not_found", "Không tìm thấy công ty");
  }

  return ok(data as Company);
}

/**
 * The company names linked to one partner, alphabetically.
 *
 * Round 32 — split into two layers:
 *   - `companiesForOnePartner` (export) is the public, lazy entry point used
 *     by the combobox. It guards on `organizationId` so a partner that belongs
 *     to another tenant returns `[]` (same "do not leak existence" rule as
 *     `getPartner`).
 *   - `companiesForPartnerInternal` (file-private) is the cheap variant used
 *     by callers that have already verified the partner belongs to the
 *     caller's organization: `getPartner`, `setPartnerStatus`,
 *     `findBlockingTaxCodeConflict`. It skips the second lookup.
 */
async function companiesForPartnerInternal(
  partnerId: string,
  options?: { abortSignal?: AbortSignal },
): Promise<string[]> {
  const supabase = await createClient(options);
  let query = supabase
    .from("partner_companies")
    .select("companies(name)")
    .eq("partner_id", partnerId);

  if (options?.abortSignal) {
    query = query.abortSignal(options.abortSignal);
  }

  const { data } = await query;

  const names: string[] = [];
  for (const row of (data ?? []) as {
    companies: { name: string } | { name: string }[] | null;
  }[]) {
    const embedded = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    if (embedded?.name) names.push(embedded.name);
  }

  return names.sort();
}

/**
 * Round 32 — công ty liên kết của 1 đối tác, gọi lazy từ combobox.
 *
 * RLS đã chặn partner ở org khác ở mức `partner_companies`, nhưng check
 * tường minh `organization_id` trên bảng `partners` để trả về []
 * thay vì lộ sự tồn tại (giống `getPartner`).
 *
 * Khi partner không thuộc `organizationId` → `{ ok: true, data: [] }`.
 * Lỗi DB được log qua `console.error` nhưng trả `[]` để không chặn luồng
 * nghiệp vụ — đây là hàm lazy từ UI, không nằm trên đường chính của
 * mutation.
 */
export async function companiesForOnePartner(
  partnerId: unknown,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<string[]>> {
  if (typeof partnerId !== "string" || partnerId.length === 0) {
    return ok([]);
  }

  try {
    const supabase = await createClient();

    // Guard tường minh: nếu partner không thuộc org này, trả [] ngay,
    // không truy vấn `partner_companies` (tránh lộ sự tồn tại qua lỗi RLS).
    const { data: partnerRow, error: partnerError } = await supabase
      .from("partners")
      .select("id")
      .eq("id", partnerId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (partnerError) {
      console.error("[service:companiesForOnePartner] partner lookup", partnerError);
      return ok([]);
    }

    if (!partnerRow) {
      return ok([]);
    }

    return ok(await companiesForPartnerInternal(partnerId));
  } catch (error) {
    console.error("[service:companiesForOnePartner] unexpected", error);
    return ok([]);
  }
}

/**
 * Round 33+ — công ty liên kết của 1 đối tác, trả về `{id, name}[]` thay vì
 * chỉ tên.
 *
 * Hàm `companiesForOnePartner` ở trên đã trả `string[]` cho combobox (round 32
 * chỉ cần tên). Form hợp đồng ở round 33+ cần cả `id` để truyền xuống
 * `createContract` / `updateContract`, vì server `getCompany(companyId, …)`
 * tra cứu theo ID — gửi tên sẽ hỏng lúc lưu. Cùng một câu truy vấn, chỉ đổi
 * select từ `companies(name)` sang `companies(id, name)`.
 *
 * Khi partner không thuộc `organizationId` → `{ ok: true, data: [] }` (giống
 * `companiesForOnePartner` — không lộ sự tồn tại của partner ở tổ chức khác).
 * Lỗi DB cũng được nuốt tương tự vì đây là hàm lazy từ UI, không nằm trên
 * đường chính của mutation.
 */
export async function companyRowsForOnePartner(
  partnerId: unknown,
  { organizationId }: PartnerContext,
): Promise<ServiceResult<Company[]>> {
  if (typeof partnerId !== "string" || partnerId.length === 0) {
    return ok([]);
  }

  try {
    const supabase = await createClient();

    // Guard tường minh: nếu partner không thuộc org này, trả [] ngay,
    // không truy vấn `partner_companies` (tránh lộ sự tồn tại qua lỗi RLS).
    const { data: partnerRow, error: partnerError } = await supabase
      .from("partners")
      .select("id")
      .eq("id", partnerId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (partnerError) {
      console.error("[service:companyRowsForOnePartner] partner lookup", partnerError);
      return ok([]);
    }

    if (!partnerRow) {
      return ok([]);
    }

    const { data, error } = await supabase
      .from("partner_companies")
      .select("companies(id, name)")
      .eq("partner_id", partnerId);

    if (error) {
      console.error("[service:companyRowsForOnePartner] junction", error);
      return ok([]);
    }

    const rows: Company[] = [];
    for (const row of (data ?? []) as {
      companies: { id: string; name: string } | { id: string; name: string }[] | null;
    }[]) {
      const embedded = Array.isArray(row.companies) ? row.companies[0] : row.companies;
      if (embedded?.id && embedded?.name) {
        rows.push({ id: embedded.id, name: embedded.name });
      }
    }

    rows.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return ok(rows);
  } catch (error) {
    console.error("[service:companyRowsForOnePartner] unexpected", error);
    return ok([]);
  }
}

/** Bulk company names per partner, chunked for arbitrarily large partner sets. */
export async function companiesForPartners(
  partnerIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (partnerIds.length === 0) return result;

  const supabase = await createClient();
  for (let start = 0; start < partnerIds.length; start += PARTNER_ID_IN_CHUNK_SIZE) {
    const chunk = partnerIds.slice(start, start + PARTNER_ID_IN_CHUNK_SIZE);
    for (let offset = 0; ; offset += PARTNERS_BATCH_SIZE) {
      const baseQuery = supabase
        .from("partner_companies")
        .select("partner_id, company_id, companies(name)")
        .in("partner_id", chunk)
        .order("partner_id", { ascending: true })
        .order("company_id", { ascending: true });

      const supportsRange = typeof baseQuery.range === "function";
      const { data } = supportsRange
        ? await baseQuery.range(offset, offset + PARTNERS_BATCH_SIZE - 1)
        : await baseQuery;

      const rows = (data ?? []) as {
        partner_id: string;
        companies: { name: string } | { name: string }[] | null;
      }[];
      for (const row of rows) {
        const embedded = Array.isArray(row.companies) ? row.companies[0] : row.companies;
        if (!embedded?.name) continue;
        result.set(row.partner_id, [...(result.get(row.partner_id) ?? []), embedded.name]);
      }

      if (!supportsRange || rows.length < PARTNERS_BATCH_SIZE) {
        break;
      }
    }
  }

  return result;
}

/**
 * Rolls back a partner row the caller just created but whose junction insert
 * failed. The session client has no DELETE grant on `partners`, so this uses the
 * service-role client; if that is unavailable the orphan row is logged and left
 * (the caller still gets the error, so it is never silently half-saved).
 *
 * Uses an independent cleanup timeout (default 3,000ms) rather than inheriting
 * an already-aborted caller signal, ensuring the delete operation actually runs.
 */
async function deletePartnerRollback(
  partnerId: string,
  options?: { cleanupTimeoutMs?: number },
): Promise<void> {
  const signal = AbortSignal.timeout(options?.cleanupTimeoutMs ?? 3_000);
  try {
    const admin = await createAdminClient();
    let query = admin.from("partners").delete().eq("id", partnerId);
    if (signal) {
      query = query.abortSignal(signal);
    }
    await query;
  } catch (error) {
    console.error("[service:createPartner] rollback failed", error);
  }
}

/**
 * Every partner of the caller's organization, alphabetically, with its contract
 * count and linked company names.
 *
 * A10: Fetches in deterministic 1,000-row batches (`ORDER BY name ASC, id ASC`)
 * so `/api/partners/export` and service callers never truncate silently at
 * PostgREST's default 1,000-row ceiling.
 */
export async function listPartners({
  organizationId,
  contracts,
  status,
}: PartnerContext & {
  /** Round 28 — filter by the computed contract count; absent = all. */
  contracts?: "has" | "none";
  status?: PartnerStatus;
}): Promise<ServiceResult<PartnerWithCount[]>> {
  const supabase = await createClient();

  type SummaryRpcRow = PartnerRow & {
    contract_count: number | string;
    companies: string[] | null;
  };

  let withCounts: PartnerWithCount[] | null = null;
  const collectedRpcRows: SummaryRpcRow[] = [];
  let rpcFailed = false;

  for (let offset = 0; ; offset += PARTNERS_BATCH_SIZE) {
    const rpcQuery = supabase.rpc("get_partners_summary", {
      org_id: organizationId,
    });
    const supportsRange = typeof rpcQuery.range === "function";
    const { data: rpcData, error: rpcError } = supportsRange
      ? await rpcQuery.range(offset, offset + PARTNERS_BATCH_SIZE - 1)
      : await rpcQuery;

    if (rpcError || !Array.isArray(rpcData)) {
      rpcFailed = true;
      break;
    }

    const batch = rpcData as SummaryRpcRow[];
    collectedRpcRows.push(...batch);
    if (!supportsRange || batch.length < PARTNERS_BATCH_SIZE) {
      break;
    }
  }

  if (!rpcFailed) {
    const seen = new Set<string>();
    withCounts = [];
    for (const row of collectedRpcRows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      withCounts.push({
        ...row,
        contract_count: Number(row.contract_count) || 0,
        companies: (row.companies ?? []).sort(),
      });
    }
  } else {
    const collectedRows: PartnerRow[] = [];
    const seen = new Set<string>();

    for (let offset = 0; ; offset += PARTNERS_BATCH_SIZE) {
      const baseQuery = supabase
        .from("partners")
        .select(PARTNER_COLUMNS)
        .eq("organization_id", organizationId)
        .order("name", { ascending: true })
        .order("id", { ascending: true });

      const supportsRange = typeof baseQuery.range === "function";
      const { data, error } = supportsRange
        ? await baseQuery.range(offset, offset + PARTNERS_BATCH_SIZE - 1)
        : await baseQuery;

      if (error) {
        return dbError("listPartners", error);
      }

      const batch = (data ?? []) as PartnerRow[];
      for (const row of batch) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        collectedRows.push(row);
      }

      if (!supportsRange || batch.length < PARTNERS_BATCH_SIZE) {
        break;
      }
    }

    const partnerIds = collectedRows.map((row) => row.id);
    const [counts, companyMap] = await Promise.all([
      countContractsByPartner(partnerIds, organizationId),
      companiesForPartners(partnerIds),
    ]);

    withCounts = collectedRows.map((row) => ({
      ...row,
      contract_count: counts.get(row.id) ?? 0,
      companies: (companyMap.get(row.id) ?? []).sort(),
    }));
  }

  if (status) withCounts = withCounts.filter((row) => row.status === status);

  // Round 28 — the count-based filter runs AFTER the counts are computed
  // (JS filter; the list has no pagination).
  if (contracts === "has") {
    return ok(withCounts.filter((row) => row.contract_count >= 1));
  }
  if (contracts === "none") {
    return ok(withCounts.filter((row) => row.contract_count === 0));
  }

  return ok(withCounts);
}

/**
 * Paginated & server-filtered directory page for `/partners` (`A10`).
 *
 * Uses `get_partners_directory_page` RPC so organizations with > 1,000 partners
 * paginate cleanly in PostgreSQL while keeping exact total counts.
 */
export async function listPartnersDirectoryPage({
  organizationId,
  search,
  status,
  company,
  contracts,
  page = 1,
  pageSize = PARTNERS_PAGE_SIZE_DEFAULT,
}: PartnerContext & {
  search?: string;
  status?: PartnerStatus;
  company?: string;
  contracts?: "has" | "none";
  page?: number;
  pageSize?: number;
}): Promise<ServiceResult<PartnersDirectoryPage>> {
  const safePageSize = Math.min(
    Math.max(1, Number.isFinite(pageSize) ? Math.trunc(pageSize) : PARTNERS_PAGE_SIZE_DEFAULT),
    PARTNERS_PAGE_SIZE_MAX,
  );
  let safePage = Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1);
  const normalizedSearch = search?.trim() ? search.trim().slice(0, 120) : null;
  const normalizedCompany = company?.trim() ? company.trim() : null;

  type DirectoryRpcRow = PartnerRow & {
    contract_count: number | string;
    companies: string[] | null;
    total_count: number | string;
  };

  const supabase = await createClient();
  const runRpc = async (offset: number) =>
    supabase.rpc("get_partners_directory_page", {
      p_org_id: organizationId,
      p_search: normalizedSearch,
      p_status: status ?? null,
      p_company: normalizedCompany,
      p_contracts: contracts ?? null,
      p_limit: safePageSize,
      p_offset: offset,
    });

  const { data: rpcData, error: rpcError } = await runRpc((safePage - 1) * safePageSize);

  if (rpcError) {
    // Graceful fallback if the migration has not been applied yet on an ephemeral environment.
    if (rpcError.code === "PGRST202" || rpcError.message?.includes("get_partners_directory_page")) {
      const full = await listPartners({ organizationId, status, contracts });
      if (!full.ok) return full;

      let filtered = full.data;
      if (normalizedCompany) {
        filtered = filtered.filter((row) => row.companies.includes(normalizedCompany));
      }
      if (normalizedSearch) {
        const needle = foldText(normalizedSearch);
        if (needle) {
          filtered = filtered.filter(
            (row) =>
              foldText(row.name).includes(needle) ||
              foldText(row.tax_code ?? "").includes(needle) ||
              foldText(row.abbreviation ?? "").includes(needle) ||
              foldText(row.region ?? "").includes(needle),
          );
        }
      }

      const totalCount = filtered.length;
      const pageCount = Math.max(1, Math.ceil(totalCount / safePageSize));
      const clampedPage = Math.min(safePage, pageCount);
      const start = (clampedPage - 1) * safePageSize;
      return ok({
        rows: filtered.slice(start, start + safePageSize),
        totalCount,
        page: clampedPage,
        pageSize: safePageSize,
        pageCount,
      });
    }

    return dbError("listPartnersDirectoryPage", rpcError);
  }

  let rpcRows = (rpcData ?? []) as DirectoryRpcRow[];
  if (rpcRows.length === 0 && safePage > 1) {
    const firstPage = await runRpc(0);
    if (firstPage.error) {
      return dbError("listPartnersDirectoryPage", firstPage.error);
    }
    const firstRows = (firstPage.data ?? []) as DirectoryRpcRow[];
    if (firstRows.length === 0) {
      return ok({
        rows: [],
        totalCount: 0,
        page: 1,
        pageSize: safePageSize,
        pageCount: 1,
      });
    }

    const totalFromFirst = Number(firstRows[0]?.total_count) || firstRows.length;
    const lastPage = Math.max(1, Math.ceil(totalFromFirst / safePageSize));
    safePage = lastPage;
    if (lastPage === 1) {
      rpcRows = firstRows;
    } else {
      const clampedRes = await runRpc((lastPage - 1) * safePageSize);
      if (clampedRes.error) {
        return dbError("listPartnersDirectoryPage", clampedRes.error);
      }
      rpcRows = (clampedRes.data ?? []) as DirectoryRpcRow[];
    }
  }

  const totalCount = rpcRows.length > 0 ? Number(rpcRows[0]?.total_count) || rpcRows.length : 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / safePageSize));

  return ok({
    rows: rpcRows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      name: row.name,
      address: row.address,
      tax_code: row.tax_code,
      region: row.region,
      abbreviation: row.abbreviation,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      contract_count: Number(row.contract_count) || 0,
      companies: (row.companies ?? []).sort(),
    })),
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    pageCount,
  });
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
  options?: { abortSignal?: AbortSignal },
): Promise<ServiceResult<PartnerSearchRow[]>> {
  const supabase = await createClient(options);
  const query = term.trim().slice(0, 100);

  let req = supabase.rpc("search_partners", {
    term: query,
    lim: PARTNER_SEARCH_LIMIT,
  });

  if (options?.abortSignal) {
    req = req.abortSignal(options.abortSignal);
  }

  try {
    const { data, error } = await req;
    if (error) {
      if (options?.abortSignal?.aborted) {
        return err("db_error", "Tìm kiếm đối tác bị hủy do quá thời gian");
      }
      return dbError("searchPartners", error);
    }
    return ok((data ?? []) as PartnerSearchRow[]);
  } catch (error) {
    if (options?.abortSignal?.aborted) {
      return err("db_error", "Tìm kiếm đối tác bị hủy do quá thời gian");
    }
    return dbError("searchPartners", error);
  }
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

  const companies = await companiesForPartnerInternal(id);
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
  options?: { abortSignal?: AbortSignal },
): Promise<Map<string, PartnerRow[]>> {
  const result = new Map<string, PartnerRow[]>();
  const unique = [
    ...new Set(
      taxCodes.map((code) => (typeof code === "string" ? code.trim() : "")).filter(Boolean),
    ),
  ];

  if (unique.length === 0) return result;

  const supabase = await createClient(options);

  // PostgREST URLs have a practical length limit; chunk to stay well inside it.
  for (let start = 0; start < unique.length; start += 100) {
    const chunk = unique.slice(start, start + 100);
    let query = supabase
      .from("partners")
      .select(PARTNER_COLUMNS)
      .eq("organization_id", organizationId)
      .in("tax_code", chunk);

    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }

    const { data } = await query;

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
  options?: { abortSignal?: AbortSignal },
): Promise<PartnerRow | null> {
  const matches = (await findPartnersByTaxCodes([taxCode], organizationId, options)).get(
    taxCode.trim(),
  );

  if (!matches || matches.length === 0) return null;

  return matches.find((row) => !excludeId || row.id !== excludeId) ?? null;
}

/**
 * Round 29 — the tax-code conflict is COMPANY-AWARE.
 *
 * The same tax code under a COMPLETELY different company is allowed (mirrors
 * the round 25 import rule); an overlap with the caller's companies still
 * blocks. `incomingCompanyNames === null` means the caller sent no company
 * info (an update that leaves the companies untouched) — the old strict
 * behaviour stays in that case.
 */
async function findBlockingTaxCodeConflict(
  taxCode: string,
  organizationId: string,
  incomingCompanyNames: string[] | null,
  excludeId?: string,
  options?: { abortSignal?: AbortSignal },
): Promise<PartnerRow | null> {
  const conflict = await findPartnerByTaxCode(taxCode, organizationId, excludeId, options);
  if (!conflict) return null;

  if (incomingCompanyNames === null) return conflict;

  const existingNames = await companiesForPartnerInternal(conflict.id, options);
  const overlap = existingNames.filter((name) => incomingCompanyNames.includes(name));
  return overlap.length > 0 ? conflict : null;
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
  options?: { abortSignal?: AbortSignal },
): Promise<ServiceResult<PartnerDetail>> {
  if (options?.abortSignal?.aborted) {
    return err("db_error", "Yêu cầu tạo đối tác đã bị hủy do quá thời gian");
  }

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

  // Every chosen company must belong to the caller's organization, or the
  // junction would link another tenant's company onto this partner.
  const companies = await listCompanies({ organizationId }, options);
  if (!companies.ok) return companies;

  const orgCompanies = companies.data;
  const orgCompanyIds = new Set(orgCompanies.map((company) => company.id));
  const invalidCompany = companyIds.find((id) => !orgCompanyIds.has(id));
  if (invalidCompany) {
    return err("validation", "Công ty được chọn không thuộc tổ chức của bạn");
  }

  const companyNames = orgCompanies
    .filter((company) => companyIds.includes(company.id))
    .map((company) => company.name)
    .sort();

  // Round 29 — the tax-code check runs with the company names: the same code
  // under a completely different company is allowed.
  if (taxCode) {
    const conflict = await findBlockingTaxCodeConflict(
      taxCode,
      organizationId,
      companyNames,
      undefined,
      options,
    );
    if (conflict) {
      return err(
        "validation",
        "Mã số thuế đã được dùng cho đối tác khác trong tổ chức",
        [{ path: "taxCode", message: `Đã thuộc về "${conflict.name}"` }],
      );
    }
  }

  const supabase = await createClient(options);
  let created: PartnerRow | null = null;

  try {
    let insertQuery = supabase
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
      .select(PARTNER_COLUMNS);

    if (options?.abortSignal) {
      insertQuery = insertQuery.abortSignal(options.abortSignal);
    }

    const { data, error } = await insertQuery.single();

    if (error) {
      if (options?.abortSignal?.aborted) {
        return err("db_error", "Yêu cầu tạo đối tác đã bị hủy do quá thời gian");
      }
      return dbError("createPartner", error);
    }

    const savedPartner = data as PartnerRow;
    created = savedPartner;

    // Junction — after the partner row exists. On failure, roll the partner back
    // so a half-saved partner (present but linked to no company) cannot survive.
    let junctionQuery = supabase
      .from("partner_companies")
      .insert(companyIds.map((companyId) => ({ partner_id: savedPartner.id, company_id: companyId })));

    if (options?.abortSignal) {
      junctionQuery = junctionQuery.abortSignal(options.abortSignal);
    }

    const { error: junctionError } = await junctionQuery;

    if (junctionError) {
      await deletePartnerRollback(created.id, { cleanupTimeoutMs: 3_000 });
      if (options?.abortSignal?.aborted) {
        return err("db_error", "Yêu cầu tạo đối tác đã bị hủy do quá thời gian");
      }
      return dbError("createPartner", junctionError);
    }

    return ok({ ...savedPartner, companies: companyNames });
  } catch (errCatch) {
    if (created) {
      await deletePartnerRollback(created.id, { cleanupTimeoutMs: 3_000 });
    }
    if (options?.abortSignal?.aborted) {
      return err("db_error", "Yêu cầu tạo đối tác đã bị hủy do quá thời gian");
    }
    return dbError("createPartner", errCatch);
  }
}

/**
 * In-process promise map to deduplicate simultaneous AI partner creations
 * within the same Node.js instance. Keyed by `${organizationId}:${normalizedName}`.
 */
const inFlightAiPartnerCreations = new Map<
  string,
  Promise<ServiceResult<AiPartnerLookupResult>>
>();

export type AiPartnerLookupResult = {
  id: string;
  name: string;
  isNew: boolean;
};

/**
 * Atomic partner lookup / creation for AI contract extraction flow.
 *
 * Guarantees idempotency and eliminates race conditions when concurrent
 * actions process contracts with the same partner name or tax code:
 * 1. Checks in-process mutex to deduplicate concurrent calls within the same process.
 * 2. Invokes Postgres RPC `find_or_create_partner_for_ai`, which acquires
 *    transaction-level advisory locks (`pg_advisory_xact_lock`) on both name
 *    and tax-code domains, and enforces company-aware matching.
 * 3. Never silently falls back to non-atomic creation.
 */
export async function findOrCreatePartnerForAi(
  input: {
    name: string;
    taxCode?: string;
    address?: string;
    companyIds: string[];
  },
  { organizationId }: PartnerContext,
  options?: { abortSignal?: AbortSignal },
): Promise<ServiceResult<AiPartnerLookupResult>> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return err("validation", "Tên đối tác không được để trống");
  }

  if (!input.companyIds || input.companyIds.length === 0) {
    return err("validation", "Chọn ít nhất một công ty cho đối tác");
  }

  const cleanTax = input.taxCode?.trim() || "";
  const dedupKey = `${organizationId}:${trimmedName.toLowerCase()}`;
  const existingInFlight = inFlightAiPartnerCreations.get(dedupKey);
  if (existingInFlight) {
    return await existingInFlight;
  }

  const creationPromise = (async (): Promise<ServiceResult<AiPartnerLookupResult>> => {
    if (options?.abortSignal?.aborted) {
      return err("db_error", "Yêu cầu tạo đối tác đã bị hủy do quá thời gian");
    }

    try {
      const supabase = await createClient(options);
      let rpcReq = supabase.rpc("find_or_create_partner_for_ai", {
        p_org_id: organizationId,
        p_name: trimmedName,
        p_tax_code: cleanTax || null,
        p_address: input.address?.trim() || null,
        p_company_ids: input.companyIds,
      });

      if (options?.abortSignal) {
        rpcReq = rpcReq.abortSignal(options.abortSignal);
      }

      const { data: rpcData, error: rpcError } = await rpcReq;

      if (rpcError) {
        if (options?.abortSignal?.aborted) {
          return err("db_error", "Yêu cầu tạo đối tác đã bị hủy do quá thời gian");
        }
        return dbError("findOrCreatePartnerForAi", rpcError);
      }

      if (!Array.isArray(rpcData) || rpcData.length === 0) {
        return err("db_error", "Không nhận được phản hồi hợp lệ từ hàm tạo đối tác nguyên tử");
      }

      const row = rpcData[0] as { id: string; name: string; is_new: boolean };
      return ok({
        id: row.id,
        name: row.name,
        isNew: row.is_new,
      });
    } catch (catchedError) {
      if (options?.abortSignal?.aborted) {
        return err("db_error", "Yêu cầu tạo đối tác đã bị hủy do quá thời gian");
      }
      return dbError("findOrCreatePartnerForAi", catchedError);
    }
  })();

  inFlightAiPartnerCreations.set(dedupKey, creationPromise);
  try {
    return await creationPromise;
  } finally {
    inFlightAiPartnerCreations.delete(dedupKey);
  }
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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_partner_atomic", {
    p_id: id, p_organization_id: organizationId, p_patch: patch,
    p_company_ids: hasCompanies ? [...new Set(parsed.data.companyIds)] : null,
  });
  if (error) {
    if (error.code === "23505") {
      return err("validation", "Mã số thuế đã được dùng cho đối tác khác trong cùng công ty", [
        { path: "taxCode", message: "Mã số thuế bị trùng trong công ty được chọn" },
      ]);
    }
    return dbError("updatePartner", error);
  }
  if (!data) return err("not_found", "Không tìm thấy đối tác");
  const updated = data as PartnerDetail;

  return ok(updated);
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
  const companies = await companiesForPartnerInternal(id);

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
  | "hasCompanyColumn"
>;

/**
 * Loads only candidate existing partners that could possibly match the incoming
 * Excel import batch on folded tax code or folded name (`A10`), avoiding
 * full-directory scans and > 1,000-row truncation on large tenants.
 */
async function loadCandidateMergePartners(
  rows: PartnerImportServiceRow[],
  organizationId: string,
): Promise<ServiceResult<MergeablePartner[]>> {
  const foldedTaxCodes = [
    ...new Set(
      rows
        .map((row) => foldText(row.taxCode ?? ""))
        .filter((value) => value.length > 0),
    ),
  ];
  const foldedNames = [
    ...new Set(
      rows
        .map((row) => foldText(row.name ?? ""))
        .filter((value) => value.length > 0),
    ),
  ];

  if (foldedTaxCodes.length === 0 && foldedNames.length === 0) {
    return ok([]);
  }

  const supabase = await createClient();
  const byId = new Map<string, PartnerRow>();

  const fallbackToFullDirectory = async (): Promise<ServiceResult<MergeablePartner[]>> => {
    const directory = await listPartners({ organizationId });
    if (!directory.ok) return directory;
    return ok(
      directory.data.map((partner) => ({
        id: partner.id,
        name: partner.name,
        tax_code: partner.tax_code,
        abbreviation: partner.abbreviation,
        region: partner.region,
        address: partner.address,
        status: partner.status,
        companies: partner.companies,
      })),
    );
  };

  for (let start = 0; start < foldedTaxCodes.length; start += 100) {
    const chunk = foldedTaxCodes.slice(start, start + 100);
    const { data, error } = await supabase
      .from("partners")
      .select(PARTNER_COLUMNS)
      .eq("organization_id", organizationId)
      .in("tax_code_folded", chunk);

    if (error) {
      if (error.code === "42703" || error.message?.includes("folded")) {
        return fallbackToFullDirectory();
      }
      return dbError("loadCandidateMergePartners", error);
    }

    for (const row of (data ?? []) as PartnerRow[]) {
      byId.set(row.id, row);
    }
  }

  for (let start = 0; start < foldedNames.length; start += 100) {
    const chunk = foldedNames.slice(start, start + 100);
    const { data, error } = await supabase
      .from("partners")
      .select(PARTNER_COLUMNS)
      .eq("organization_id", organizationId)
      .in("name_folded", chunk);

    if (error) {
      if (error.code === "42703" || error.message?.includes("folded")) {
        return fallbackToFullDirectory();
      }
      return dbError("loadCandidateMergePartners", error);
    }

    for (const row of (data ?? []) as PartnerRow[]) {
      byId.set(row.id, row);
    }
  }

  const candidates = [...byId.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const companyMap = await companiesForPartners(candidates.map((row) => row.id));

  return ok(
    candidates.map((partner) => ({
      id: partner.id,
      name: partner.name,
      tax_code: partner.tax_code,
      abbreviation: partner.abbreviation,
      region: partner.region,
      address: partner.address,
      status: partner.status,
      companies: (companyMap.get(partner.id) ?? []).sort(),
    })),
  );
}

/**
 * Preview — round 25: predicts, for every valid row, whether the import will
 * CREATE a partner ("Thêm mới") or MERGE into an existing one ("Cập nhật"),
 * WITHOUT writing anything.
 *
 * The same 5-key rule the import uses runs against the organization's
 * directory, and the directory is updated in-memory row by row so a later row
 * in the same file is predicted against what the earlier rows would have done.
 * A match carries `updated: true`, the target id and the partner's name.
 */
export async function previewPartnerImport(
  rows: PartnerImportServiceRow[],
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerImportRowReport[]>> {
  const candidates = await loadCandidateMergePartners(rows, organizationId);
  if (!candidates.ok) return candidates;

  const existing: MergeablePartner[] = [...candidates.data];

  return ok(
    rows.map((row): PartnerImportRowReport => {
      const base: PartnerImportRowReport = {
        rowNumber: row.rowNumber,
        name: row.name,
        address: row.address,
        taxCode: row.taxCode,
        region: row.region,
        abbreviation: row.abbreviation,
        status: row.status,
        companies: row.companies,
        hasCompanyColumn: row.hasCompanyColumn,
        ok: true,
      };

      const incoming: MergeIncoming = {
        name: row.name ?? "",
        taxCode: row.taxCode ?? "",
        abbreviation: row.abbreviation ?? "",
        region: row.region ?? "",
        address: row.address ?? "",
        status: row.status ?? null,
        companies: row.companies ?? [],
        hasCompanyColumn: Boolean(row.hasCompanyColumn),
      };

      const match = matchExistingPartner(existing, incoming);

      if (match) {
        // Predict the merge in-memory for the rows that follow.
        const index = existing.findIndex((partner) => partner.id === match.id);
        if (index >= 0) {
          existing[index] = mergeDirectoryEntry(match, incoming);
        }

        return {
          ...base,
          updated: true,
          partnerId: match.id,
          matchedPartnerName: match.name,
        };
      }

      // Predict the create in-memory for the rows that follow.
      existing.push({
        id: `preview-${row.rowNumber}`,
        name: incoming.name,
        tax_code: incoming.taxCode === "" ? null : incoming.taxCode,
        address: incoming.address === "" ? null : incoming.address,
        region: incoming.region === "" ? null : incoming.region,
        abbreviation: incoming.abbreviation === "" ? null : incoming.abbreviation,
        status: incoming.status ?? "active",
        companies: incoming.companies,
      });

      return { ...base };
    }),
  );
}

/**
 * Imports the given validated rows, one by one — round 25 adds the merge.
 *
 * One failing row never stops the batch: the per-row result carries its own
 * `ok`/`error`, and the caller reports the summary. A row that matches an
 * existing partner (the 5-key rule in `lib/partner-merge.ts`) OVERWRITES it
 * instead of failing — except when the file carries a "Công ty" column and no
 * existing partner shares a company, in which case a new partner is created.
 * Each imported partner is linked to its resolved companies.
 */
export async function importPartners(
  rows: PartnerImportServiceRow[],
  { organizationId }: PartnerContext,
): Promise<ServiceResult<PartnerImportRowReport[]>> {
  // The parse already validated names against the known companies; resolve them
  // to database ids here (folded, case-insensitive).
  const companies = await listCompanies({ organizationId });
  if (!companies.ok) return companies;

  const companyIdByName = new Map(
    companies.data.map((company) => [company.name.trim().toLowerCase(), company.id]),
  );

  // A10: Load only candidate existing partners matching the batch's folded
  // tax codes or folded names (with company links hydrated).
  const candidates = await loadCandidateMergePartners(rows, organizationId);
  if (!candidates.ok) return candidates;

  const existing: MergeablePartner[] = [...candidates.data];

  const supabase = await createClient();
  const results: PartnerImportRowReport[] = [];

  const reportRow = (
    row: PartnerImportServiceRow,
    extra: {
      ok: boolean;
      error?: string;
      partnerId?: string;
      updated?: boolean;
      matchedPartnerName?: string;
    },
  ): PartnerImportRowReport => ({
    rowNumber: row.rowNumber,
    name: row.name,
    address: row.address,
    taxCode: row.taxCode,
    region: row.region,
    abbreviation: row.abbreviation,
    status: row.status,
    companies: row.companies,
    hasCompanyColumn: row.hasCompanyColumn,
    ok: extra.ok,
    ...(extra.error ? { error: extra.error } : {}),
    ...(extra.partnerId ? { partnerId: extra.partnerId } : {}),
    ...(extra.updated ? { updated: true } : {}),
    ...(extra.matchedPartnerName
      ? { matchedPartnerName: extra.matchedPartnerName }
      : {}),
  });

  for (const row of rows) {
    const code = row.taxCode.trim();
    const companyIds = row.companies
      .map((name) => companyIdByName.get(name.trim().toLowerCase()))
      .filter((id): id is string => Boolean(id));

    if (companyIds.length === 0) {
      results.push(reportRow(row, { ok: false, error: "Không nhận diện được công ty" }));
      continue;
    }

    const incoming: MergeIncoming = {
      name: row.name ?? "",
      taxCode: row.taxCode ?? "",
      abbreviation: row.abbreviation ?? "",
      region: row.region ?? "",
      address: row.address ?? "",
      status: row.status ?? null,
      companies: row.companies ?? [],
      hasCompanyColumn: Boolean(row.hasCompanyColumn),
    };

    const match = matchExistingPartner(existing, incoming);

    try {
      if (match) {
        // MERGE — overwrite the matched partner.
        const { patch, companiesToAdd } = buildMergePatch(match, incoming);

        if (Object.keys(patch).length > 0) {
          const { error: updateError } = await supabase
            .from("partners")
            .update(patch)
            .eq("id", match.id)
            .eq("organization_id", organizationId);

          if (updateError) {
            if (updateError) console.error("[service:importPartners]", updateError);
            results.push(reportRow(row, {
              ok: false,
              error: "Không thể cập nhật đối tác này. Vui lòng thử lại.",
            }));
            continue;
          }
        }

        if (companiesToAdd.length > 0) {
          const newIds = companiesToAdd
            .map((name) => companyIdByName.get(name.trim().toLowerCase()))
            .filter((id): id is string => Boolean(id));

          if (newIds.length > 0) {
            const { error: junctionError } = await supabase
              .from("partner_companies")
              .insert(newIds.map((companyId) => ({ partner_id: match.id, company_id: companyId })));

            if (junctionError) {
              console.error("[service:importPartners]", junctionError);
              results.push(reportRow(row, {
                ok: false,
                error: "Không thể cập nhật đối tác này. Vui lòng thử lại.",
              }));
              continue;
            }
          }
        }

        // Keep the in-memory directory in sync so a later row in the SAME file
        // can match the merged state.
        const index = existing.findIndex((partner) => partner.id === match.id);
        if (index >= 0) {
          existing[index] = mergeDirectoryEntry(match, incoming);
        }

        results.push(
          reportRow(row, {
            ok: true,
            updated: true,
            partnerId: match.id,
            matchedPartnerName: match.name,
          }),
        );
        continue;
      }

      // CREATE — no match (or a different company).
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
        results.push(reportRow(row, {
          ok: false,
          error: "Không thể tạo đối tác này. Vui lòng thử lại.",
        }));
        continue;
      }

      const partnerId = (data as { id: string }).id;

      const { error: junctionError } = await supabase
        .from("partner_companies")
        .insert(companyIds.map((companyId) => ({ partner_id: partnerId, company_id: companyId })));

      if (junctionError) {
        await deletePartnerRollback(partnerId);
        results.push(reportRow(row, {
          ok: false,
          error: "Không thể tạo đối tác này. Vui lòng thử lại.",
        }));
        continue;
      }

      existing.push({
        id: partnerId,
        name: row.name,
        tax_code: code === "" ? null : code,
        address: row.address.trim() === "" ? null : row.address.trim(),
        region: normaliseOptionalText(row.region) ?? null,
        abbreviation: normaliseOptionalText(row.abbreviation) ?? null,
        status: row.status ?? "active",
        companies: row.companies,
      });

      results.push(reportRow(row, { ok: true, partnerId }));
    } catch {
      results.push(reportRow(row, {
        ok: false,
        error: "Không thể tạo đối tác này. Vui lòng thử lại.",
      }));
    }
  }

  // One audit row for the whole batch, with the outcome counts.
  if (results.length > 0) {
    const created = results.filter((row) => row.ok && !row.updated).length;
    const updated = results.filter((row) => row.ok && row.updated).length;
    await recordCurrentUserAudit({
      action: "import_partners",
      targetKind: "partner",
      targetId: null,
      metadata: { created, updated, failed: results.length - created - updated },
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
  if (!canDeleteEntities(user)) {
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
  if (!canDeleteEntities(user)) {
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
