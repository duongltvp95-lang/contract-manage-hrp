import { addDays, format } from "date-fns";

/**
 * Contract list query state — plan sections 50-53.
 *
 * Lives in the URL (`/contracts?q=samsung&preset=expiring90&page=2`) so the list
 * stays server-rendered and shareable. This module is pure and framework-free,
 * so both the server page and the Client Component controls can use it.
 *
 * NOTE: do not add `server-only` here — the filter controls are Client
 * Components.
 */

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export const SORT_OPTIONS = [
  "updated_at",
  "signed_date",
  "expiry_date",
  "created_at",
  "contract_number",
] as const;
export type SortField = (typeof SORT_OPTIONS)[number];

export const PRESET_OPTIONS = ["expired", "expiring30", "expiring90"] as const;
export type ExpiryPreset = (typeof PRESET_OPTIONS)[number];

export const PRESET_LABELS: Record<ExpiryPreset, string> = {
  expired: "Đã hết hạn",
  expiring30: "Hết hạn trong 30 ngày",
  expiring90: "Hết hạn trong 90 ngày",
};

export type SortDirection = "asc" | "desc";

export type ContractsQuery = {
  q: string;
  preset: ExpiryPreset | "";
  signedFrom: string;
  signedTo: string;
  expiryFrom: string;
  expiryTo: string;
  /** Feature round 2: show only contracts linked to this partner. */
  partnerId: string;
  page: number;
  pageSize: PageSize;
  sort: SortField;
  dir: SortDirection;
};

export const DEFAULT_PAGE_SIZE: PageSize = 25;
export const DEFAULT_SORT: SortField = "updated_at";
export const DEFAULT_DIR: SortDirection = "desc";

export const DEFAULT_QUERY: ContractsQuery = {
  q: "",
  preset: "",
  signedFrom: "",
  signedTo: "",
  expiryFrom: "",
  expiryTo: "",
  partnerId: "",
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sort: DEFAULT_SORT,
  dir: DEFAULT_DIR,
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Only a real uuid is accepted.
 *
 * The value travels into a PostgREST `eq` filter, so anything that is not a
 * uuid could carry filter syntax; a partner that does not exist and a value that
 * was never an id both become "no partner filter".
 */
function isValidGuid(value: string): boolean {
  return GUID_RE.test(value);
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isValidDate(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

/** Reads and validates the URL state. Anything unrecognised falls back safely. */
export function parseContractsQuery(params: RawParams): ContractsQuery {
  const rawPage = Number.parseInt(first(params.page), 10);
  const rawPageSize = Number.parseInt(first(params.pageSize), 10);
  const rawSort = first(params.sort);
  const rawDir = first(params.dir);
  const rawPreset = first(params.preset);

  const dateOrEmpty = (value: string) => (isValidDate(value) ? value : "");

  return {
    q: first(params.q).slice(0, 100),
    preset: (PRESET_OPTIONS as readonly string[]).includes(rawPreset)
      ? (rawPreset as ExpiryPreset)
      : "",
    signedFrom: dateOrEmpty(first(params.signedFrom)),
    signedTo: dateOrEmpty(first(params.signedTo)),
    expiryFrom: dateOrEmpty(first(params.expiryFrom)),
    expiryTo: dateOrEmpty(first(params.expiryTo)),
    partnerId: isValidGuid(first(params.partnerId)) ? first(params.partnerId) : "",
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPageSize)
      ? (rawPageSize as PageSize)
      : DEFAULT_PAGE_SIZE,
    sort: (SORT_OPTIONS as readonly string[]).includes(rawSort)
      ? (rawSort as SortField)
      : DEFAULT_SORT,
    dir: rawDir === "asc" ? "asc" : DEFAULT_DIR,
  };
}

/** Builds `/contracts?...`, omitting anything still at its default. */
export function contractsHref(
  patch: Partial<ContractsQuery>,
  base: ContractsQuery = DEFAULT_QUERY,
): string {
  const next = { ...base, ...patch };
  const params = new URLSearchParams();

  if (next.q) params.set("q", next.q);
  if (next.preset) params.set("preset", next.preset);
  if (next.signedFrom) params.set("signedFrom", next.signedFrom);
  if (next.signedTo) params.set("signedTo", next.signedTo);
  if (next.expiryFrom) params.set("expiryFrom", next.expiryFrom);
  if (next.expiryTo) params.set("expiryTo", next.expiryTo);
  if (next.partnerId) params.set("partnerId", next.partnerId);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(next.pageSize));
  if (next.sort !== DEFAULT_SORT) params.set("sort", next.sort);
  if (next.dir !== DEFAULT_DIR) params.set("dir", next.dir);

  const search = params.toString();
  return search ? `/contracts?${search}` : "/contracts";
}

export function hasActiveFilters(query: ContractsQuery): boolean {
  return Boolean(
    query.q ||
      query.preset ||
      query.signedFrom ||
      query.signedTo ||
      query.expiryFrom ||
      query.expiryTo ||
      query.partnerId,
  );
}

export type DateRange = { gte?: string; lte?: string; lt?: string };

const isoDay = (date: Date) => format(date, "yyyy-MM-dd");

/**
 * Preset ranges — plan sections 52, 69, 70:
 *   expired    : expiry_date < today
 *   expiring30 : today <= expiry_date <= today + 30 days
 *   expiring90 : today <= expiry_date <= today + 90 days
 *
 * `today` is injectable so the behaviour is testable.
 */
export function resolveExpiryPreset(
  preset: ExpiryPreset,
  today: Date = new Date(),
): DateRange {
  switch (preset) {
    case "expired":
      return { lt: isoDay(today) };
    case "expiring30":
      return { gte: isoDay(today), lte: isoDay(addDays(today, 30)) };
    case "expiring90":
      return { gte: isoDay(today), lte: isoDay(addDays(today, 90)) };
    default:
      return {};
  }
}

/**
 * Strips the characters that carry meaning inside a PostgREST `or=(...)` filter
 * so user input cannot break out of the pattern and inject another condition.
 *
 * `%` and `_` are deliberately left alone: they are ordinary SQL LIKE wildcards
 * and behave as users expect in a search box.
 */
export function sanitizeSearchTerm(input: string): string {
  return input
    .replace(/[,()"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
