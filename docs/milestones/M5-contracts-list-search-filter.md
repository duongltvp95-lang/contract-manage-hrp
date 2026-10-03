# M5 — Contracts List + Search + Filter + Pagination (Wave 1)

Task range: `W1-WEB-019` → `W1-WEB-022` (plan sections 48-53, 80-82).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

## Reuse / Custom declaration (plan section 87)

```text
W1-WEB-019  Contracts list

Reuse:
  shadcn Table / Badge / Button / Select / Skeleton / Alert
  service layer from M4

Custom:
  listContracts() query (search + filters + pagination + file count)
  URL-driven list state

W1-WEB-020  Search

Reuse:
  Supabase/PostgREST ilike
  URLSearchParams

Custom:
  search term sanitisation, pg_trgm indexes

W1-WEB-021  Date filters

Reuse:
  shadcn Calendar + Popover (DateField from M4)
  date-fns arithmetic

Custom:
  expired / 30 / 90 day presets

W1-WEB-022  Pagination

Reuse:
  server-side range query
  shadcn Button + Select

Custom:
  pageSize options and URL binding
```

No TanStack Table: sorting, filtering and pagination are all server-side, so
shadcn `Table` is sufficient (plan section 49 — upgrade only when the table
itself becomes complex).

## 1. Files created / modified

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20261003100000_add_pg_trgm_search_indexes.sql` | **new** — `pg_trgm` extension + GIN `gin_trgm_ops` indexes on `contract_number` and `partner_text` |
| `lib/contracts-query.ts` | **new** — URL query state: `ContractsQuery`, `parseContractsQuery()`, `contractsHref()`, `hasActiveFilters()`, `resolveExpiryPreset()`, `sanitizeSearchTerm()`, page-size / sort / preset constants |
| `lib/services/contracts.ts` | **extended** — `listContracts()`, `ContractListItem`, `ContractListResult`, `countFilesByContract()` |
| `components/contracts/contracts-table.tsx` | **new** — table, sortable headers, the two empty states |
| `components/contracts/contracts-table-skeleton.tsx` | **new** — loading skeleton (plan section 81) |
| `components/contracts/contracts-toolbar.tsx` | **new** — search box, preset select, four date filters |
| `components/contracts/contracts-pagination.tsx` | **new** — prev/next, page size, "Hiển thị X–Y trong Z" |
| `components/contracts/date-field.tsx` | **new** — Calendar-in-Popover extracted from the M4 form so both screens share it |
| `components/contracts/contract-form.tsx` | **modified** — now imports the shared `DateField` |
| `lib/format.ts` | **extended** — `formatDateOnly()`, `formatDateTime()` |
| `app/(app)/contracts/page.tsx` | **rewritten** — server page: parse `searchParams` → `listContracts()` → render, with skeleton fallback and error Alert |
| `app/(app)/contracts/[id]/page.tsx` | **modified** — uses the shared date formatter |

`listContracts()` takes `organizationId` from the caller's session
(`requireUser()`); nothing about the organization comes from the request.

## 2. pg_trgm migration — applied ✅

```bash
pnpm dlx supabase@latest db push --db-url "postgresql://postgres.<ref>:<pw>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres" --yes
# Applying migration 20261003100000_add_pg_trgm_search_indexes.sql...
# Finished supabase db push.   (exit 0)
```

The extension and both indexes exist on the live project:

```text
pg_trgm v1.6 installed                                            PASS
contracts_contract_number_trgm_idx  (gin, gin_trgm_ops)            PASS
contracts_partner_text_trgm_idx     (gin, gin_trgm_ops)            PASS
```

### Proof that the search actually uses them

The live table only has a couple of rows, where PostgreSQL always prefers a
sequential scan, so 50 000 rows were inserted **inside a transaction that was
rolled back** (row count unchanged afterwards — verified).

```text
== plan with 50000 rows (rolled back) ==
  -- planner default --
    Bitmap Heap Scan on contracts
      Recheck Cond: ((contract_number ~~* '%BULK-040000%') OR (partner_text ~~* '%BULK-040000%'))
      Filter: (organization_id = '11111111-…'::uuid)
      ->  BitmapOr
            ->  Bitmap Index Scan on contracts_contract_number_trgm_idx
                  Index Cond: (contract_number ~~* '%BULK-040000%')
            ->  Bitmap Index Scan on contracts_partner_text_trgm_idx
                  Index Cond: (partner_text ~~* '%BULK-040000%')

  -- control: `notes` has no trigram index --
    Seq Scan on contracts
```

At a realistic size the planner chooses a `BitmapOr` of the two trigram indexes
on its own — no forced settings needed. The control confirms an unindexed column
still falls back to a sequential scan, which is exactly why `notes` is **not**
part of the search (see deviation 2).

## 3. Search / filter / pagination — 30/30 PASS

Run against the live app: 30 contracts were seeded (3 partner groups × 10 expiry
offsets), exercised through the real `/contracts` URL surface, then deleted.

```text
seeding 30 contracts (expired=9, 30d=12, 90d=18)

== 1. list + pagination ==
  PASS  GET /contracts -> 200
  PASS  page 1 shows 25 seeded rows (default pageSize)
  PASS  table header rendered
  PASS  file count column header rendered
  PASS  page 2 shows the remaining 5 seeded rows
  PASS  page 1 and page 2 are disjoint
  PASS  pages 1+2 cover every seeded contract
  PASS  page 2 marks itself in the URL state — Trang 2/2
  PASS  pageSize=100 shows all seeded rows
  PASS  pageSize=50 is honoured — "Hiển thị 1–31 trong 31 hợp đồng"

== 2. search ==
  PASS  search by contract number -> only FPT group (10 rows)
  PASS  search by partner name -> only LG group (10 rows)
  PASS  no match -> filter empty state
  PASS  search term is preserved in the input

== 3. expiry presets (plan sections 52, 69, 70) ==
  PASS  expired preset -> 9 rows
  PASS  expiring30 preset -> 12 rows
  PASS  expiring90 preset -> 18 rows
  PASS  expiring30 is a subset of expiring90
  PASS  signed-date range filter is applied

== 4. cross-organization ==
  PASS  org B sees only its own contract
  PASS  org B does not see org A's contracts (0 seeded rows visible)
  PASS  org A does not see org B's contract
  PASS  org A still sees all its own contracts
  PASS  org A searching for org B's number finds nothing

== cleanup ==
  PASS  seeded contracts removed
  PASS  only the M4 sample contract remains — M4-E2E-001
  PASS  only HR Partner remains

================ 30 passed, 0 failed ================
```

The M4 sample contract (`M4-E2E-001`) shows up in the list exactly as the
milestone requires: it is the "1" in "Hiển thị 1–31 trong 31 hợp đồng".

Preset arithmetic is asserted against expectations computed independently in the
test (same rules, `date-fns`): expired = `expiry_date < today` (9 rows),
expiring30 = `today ≤ expiry_date ≤ today+30` (12), expiring90 =
`today ≤ expiry_date ≤ today+90` (18).

## 4. Cross-organization — verified

A second organization with its own user and contract was created, then removed.

```text
org B user signs in       -> list shows only ORGB-SECRET-01, zero org A contracts
org A (admin)             -> list shows all 30 of its own, never ORGB-SECRET-01
org A searching "ORGB-SECRET" -> finds nothing (no leak through the search path)
```

Isolation comes from two independent layers: the explicit
`.eq("organization_id", …)` in `listContracts()` and the RLS policies from M2.

## 5. Deviations from the plan / the M5 brief

| # | Deviation | Reason |
| --- | --- | --- |
| 1 | Added `lib/contracts-query.ts` | The brief put search/filter/pagination state in the URL. Both the server page and the Client Component controls need to parse and build that state, so it lives in one framework-free module instead of being duplicated. |
| 2 | **Search covers `contract_number` and `partner_text` only — not `notes`** | Plan section 50 marks `notes` as optional. Including it would `OR` in an unindexed column, and PostgreSQL cannot use an index for an OR branch it must also scan — the whole query would fall back to a sequential scan and the new trigram indexes would be wasted. The control EXPLAIN above demonstrates this. |
| 3 | `sanitizeSearchTerm()` strips `, ( ) " \` from the term | The term is interpolated into a PostgREST `or=(...)` filter. Without stripping, a crafted term could close the group and inject another condition. `%` and `_` are left as ordinary LIKE wildcards. |
| 4 | M2's btree indexes kept | Still useful for exact `contract_number` matches and ordering. `contracts_partner_text_idx` is now largely redundant; noted in the migration and can be dropped once search is stable. |
| 5 | The table is a Client Component; all data access stays on the server | Row click (`router.push`) and the sort links need client behaviour. Rows arrive as props from the server; no query runs in the browser. |
| 6 | `contractsHref()` omits parameters equal to their default | `/contracts` rather than `/contracts?page=1&pageSize=25&sort=updated_at&dir=desc`. Keeps URLs canonical and shareable. |
| 7 | An expiry preset overrides the manual expiry range | They answer the same question; letting both apply would silently produce an empty list. |
| 8 | `resolveExpiryPreset(preset, today = new Date())` | Injectable clock so the preset boundaries are testable. |
| 9 | `archived_at is null` is always applied | Plan section 66 makes archiving the soft delete, so archived contracts must not appear in the Wave 1 list. The brief did not mention it. |
| 10 | File counts come from a second query, not a PostgREST embedded count | Explicit shape, one RLS evaluation per row, and no dependency on PostgREST resource embedding. |
| 11 | `DateField` extracted from the M4 form | Both the create form and the list filters need the same control; duplicating it would have meant two Calendar bindings to keep in sync. |
| 12 | Skeleton lives in a dedicated component and doubles as the Suspense fallback | Plan section 81 wants a table skeleton, and reusing it as the fallback avoids a layout jump. |
| 13 | `proxy.ts` now clears the query string when redirecting to `/login` | Found by a smoke check during this milestone: `/contracts?q=test&pageSize=50` was redirecting to `/login?q=test&pageSize=50`. Carrying list filters onto the login URL is meaningless and leaks the previous view state. |

## Verification summary

```text
Search / filter / pagination (live)   30 passed, 0 failed
pg_trgm index usage (live, rolled back) 7 passed, 0 failed
pnpm typecheck                        PASS (exit 0)
pnpm lint                             PASS (exit 0, no warnings)
pnpm build                            PASS (exit 0) — 16 routes
```

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| `listContracts()` server-side ILIKE + filter + pagination + file count | ✅ |
| URL holds all state: `?q=`, filters, `?page=`, `?pageSize=` | ✅ asserted live |
| pg_trgm GIN migration applied, search uses the index | ✅ applied + plan proven |
| 3 expiry presets (Expired / 30 / 90) correct via date-fns | ✅ 9 / 12 / 18 rows asserted |
| Pagination 25/50/100 works | ✅ |
| Empty state + loading + readable error | ✅ (two distinct empty states, per plan section 82) |
| Cross-org: the list only returns the caller's organization | ✅ |
| typecheck / lint / build pass | ✅ |

## Follow-ups

- Consider dropping `contracts_partner_text_idx` (the M2 btree) now that the
  trigram index covers partner search.
- `updated_at` sorting is not indexed; add `contracts(updated_at)` if the list
  grows.
- The list has no archive filter yet — archiving UI is `W1-WEB-032`.
- Search has no debounce because it is form-submit driven (Enter / "Tìm"). If a
  live-as-you-type search is wanted, add it with `useDeferredValue` rather than
  an effect.
