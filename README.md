# Contract Manager

Internal contract management system — Wave 1 (manual contract management).

Built on top of the approved base repository
`Barty-Bart/nextjs-supabase-shadcn-boilerplate`, reusing its Next.js App Router
setup, Supabase Auth integration, protected layout, sidebar and shadcn/ui
configuration.

Master plan: [`docs/plan/wave1-plan-v1.1.md`](docs/plan/wave1-plan-v1.1.md).

## Requirements

- Node.js 20+
- pnpm
- A Supabase project

## Getting started

```bash
pnpm install
cp .env.example .env.local
```

Fill `.env.local` from Supabase → Project Settings → API:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Then start the dev server:

```bash
pnpm dev
```

Open http://localhost:3000.

## Scripts

| Script            | Purpose                          |
| ----------------- | -------------------------------- |
| `pnpm dev`        | Start the development server     |
| `pnpm build`      | Production build                 |
| `pnpm start`      | Serve the production build       |
| `pnpm lint`       | ESLint                           |
| `pnpm typecheck`  | TypeScript check (no emit)       |

## Routes

| Route               | Access    | State                                  |
| ------------------- | --------- | -------------------------------------- |
| `/login`            | public    | Email + password login (Supabase Auth) |
| `/dashboard`        | protected | 3 metrics + Recent / Expiring lists    |
| `/contracts`        | protected | List + search + filters + pagination   |
| `/contracts/new`    | protected | Add Contract form + multi-file upload  |
| `/contracts/[id]`   | protected | Detail: 65/35 viewer + metadata + Edit / Archive |
| `/settings`         | protected | Profile / Organization / Password / Logout |
| `/auth/*`           | public    | Password reset, email confirm, errors  |
| `/api/files/upload-url` | protected | Presigned R2 PUT, after authorization |
| `/api/files/view-url`   | protected | Presigned R2 GET, after authorization |

`/` redirects a signed-in user to `/dashboard`, otherwise to `/login`.
Unauthenticated requests to protected routes are refused twice over: by the
session proxy (`proxy.ts`) and by `requireUser()` (`lib/auth.ts`) inside each
protected page. `/api/*` gets a JSON **401** (or **403** when the account is
deactivated) instead of an HTML redirect.

## Archive is a soft delete

`Archive` (contract detail → `More`) stamps `contracts.archived_at`. Nothing is
deleted, and Wave 1 has **no** hard-delete path and **no** unarchive UI.

- Hidden from `/contracts` and from every dashboard query.
- Still reachable by direct link, marked with an `Đã lưu trữ` badge, with Edit
  and Archive disabled — changing a record you cannot see, or archiving it
  twice, would both be confusing.
- `updateContract()` and `archiveContract()` carry `.is("archived_at", null)`, so
  an archived contract cannot be modified through the API either.

## Editing reuses one form

`components/contracts/contract-form.tsx` serves both create and edit through a
`mode` prop — plan section 65 forbids a second implementation. Only the initial
values, the action called, and the presence of the file dropzone differ (editing
never uploads files).

`updateContract()` writes **only the fields the caller sent**. The schema marks
every field optional, so a blind full-row update would NULL every column a
partial payload did not mention; an explicit `""` still clears its own field.

**There is no public sign-up.** Wave 1 accounts are provisioned by an admin
through the Supabase Dashboard or the Admin API; the `/auth/sign-up` route has
been removed. The UI language is Vietnamese.

## Upload flow

Files never pass through Next.js. The browser asks the server for a presigned
PUT, uploads straight to the private R2 bucket, then the server verifies and
records the row:

```text
form submit
  -> createContractAction()          contract row, organization from the session
  -> POST /api/files/upload-url      authorized by getContractFileAccess()
  -> PUT <presigned url>             direct to R2, real progress via XMLHttpRequest
  -> completeUploadAction()          HEAD-verifies, then inserts contract_files
  -> redirect /contracts/[id]
```

If an upload fails the contract stays saved and the form keeps its values; a
**Thử lại** button re-runs only the failed files.

## Contracts list

Everything about the list lives in the URL, so a view is always shareable:

```text
/contracts?q=samsung&preset=expiring90&signedFrom=2025-01-01&page=2&pageSize=50&sort=expiry_date&dir=asc
```

| Param | Values |
| --- | --- |
| `q` | free text — `ILIKE` over `contract_number` and `partner_text` |
| `preset` | `expired` \| `expiring30` \| `expiring90` |
| `signedFrom` / `signedTo` | `YYYY-MM-DD` |
| `expiryFrom` / `expiryTo` | `YYYY-MM-DD` |
| `page` / `pageSize` | page number, 25 / 50 / 100 |
| `sort` / `dir` | `updated_at` \| `signed_date` \| `expiry_date` \| `created_at` \| `contract_number`, `asc` \| `desc` |

Search, filters, sorting, pagination and the file count are all resolved in SQL
by `listContracts()`; the page never loads more than one page of rows.

Search is indexed with `pg_trgm` GIN indexes
(`20261003100000_add_pg_trgm_search_indexes.sql`), which is why `notes` is
deliberately **not** part of the search: OR-ing in an unindexed column would
downgrade the whole query to a sequential scan.

## Document viewer

`/contracts/[id]` splits 65% viewer / 35% metadata. `?file=<id>` deep-links a
specific document (an unknown id falls back to the newest file).

```text
open detail
  -> server authorizes + presigns the opened document   (plan section 59)
  -> document selector switches files client-side
  -> PDF: react-pdf (Document/Page) | Image: <img> + CSS transforms
  -> URL refreshed 1 minute before expiry, and on load failure
```

Everything the viewer shows comes from `/api/files/view-url`, which authorizes
through `getContractFileAccess()` before signing. R2 is private; the browser
never builds an R2 URL itself.

**R2 needs a CORS policy** for this to work in a browser — `pdf.js` fetches with
`XMLHttpRequest` and the uploader PUTs with it, so both the viewer and the
uploader are subject to preflight. The policy must allow **`GET`, `HEAD` and
`PUT`**; a read-only rule fixes the viewer and re-breaks uploading. Images are
unaffected. See
[`docs/milestones/M6-contract-detail-document-viewer.md`](docs/milestones/M6-contract-detail-document-viewer.md#0--blocker-the-r2-bucket-has-no-cors-policy--and-it-breaks-uploads-too)
for the exact rule.

PDF.js is isolated in `components/documents/pdf-canvas.tsx` and loaded with
`ssr: false`; its worker is emitted through the bundler, so there is no CDN
dependency and no vendored copy in `public/`.

## Tests

Three suites, deliberately separated by what they need (plan sections 96, 100):

| Command | What it covers | Needs |
| --- | --- | --- |
| `pnpm test` | Unit: shared Zod schemas, list-query parsing, expiry presets, date and byte formatting, signed-URL refresh policy, object-key rules, TTL clamping, rate-limit policy | nothing |
| `pnpm test:integration` | RLS isolation, the file API's authorization (including plan section 101), and the rate limit returning a real 429 — against **live Supabase** and a real Next server | `.env.local` |
| `pnpm test:e2e` | The plan section 100 matrix in a real browser: login/logout, create/edit/archive, PDF+JPG+PNG upload, multi-file, progress, retry, search, filters, pagination, PDF navigation and zoom, image preview, document switching, signed-URL refresh, cross-org DB and R2 | `.env.local` |

`pnpm test:all` runs all three.

Only the unit suite runs in CI on every push; the other two need credentials and
are wired to GitHub secrets (they skip themselves when the secrets are absent).

Two things the suites had to work around, both documented where they live:

- `vitest.config.mts` aliases `server-only` to an empty stub. The package throws
  outside a React Server Component, which would make every service import fail in
  a test.
- The test servers run with `NODE_ENV=development` and their own build directory
  (`tests/integration/global-setup.ts`, `playwright.config.ts`). A Next dev server
  started outside `development` rejects valid sessions, and Next 16 allows only
  one dev server per project directory.

## Deployment

Target: **https://cm.hrpartner.vn** on Vercel.

### 1. Prerequisites

1. **Supabase** — the migrations in `supabase/migrations/` applied in filename
   order (`pnpm dlx supabase@latest db push --db-url "<pooler dsn>"`).
2. **Cloudflare R2** — a private bucket, plus a CORS policy that allows
   `GET`, `HEAD` **and `PUT`** from the app origin. `PUT` is not optional: the
   uploader PUTs from the browser, and a read-only rule fixes the PDF viewer
   while breaking uploading. The exact policy is in
   [`docs/milestones/M6-contract-detail-document-viewer.md`](docs/milestones/M6-contract-detail-document-viewer.md#0-r2-cors-policy--required-and-it-needs-put-resolved-).
3. **Supabase Auth → URL Configuration** — add the production URL to *Site URL*
   and to *Redirect URLs* (`https://cm.hrpartner.vn/auth/confirm`,
   `https://cm.hrpartner.vn/auth/update-password`), or password reset and email
   confirmation will bounce to localhost.

### 2. Environment variables

Set every one of these in Vercel → Project → Settings → Environment Variables
(Production **and** Preview). `.env.example` documents each of them.

| Variable | Scope | Where it comes from | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase → Project Settings → API | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | same | `sb_publishable_…` or the anon JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | same | `sb_secret_…`. Never expose; it bypasses RLS |
| `APP_URL` | server | — | `https://cm.hrpartner.vn` in production |
| `MAX_UPLOAD_SIZE_MB` | server | — | defaults to 50 |
| `R2_ACCOUNT_ID` | server only | Cloudflare R2 | |
| `R2_ACCESS_KEY_ID` | server only | Cloudflare R2 API token | use the **narrowest** key that can read/write the bucket — never an account-level key |
| `R2_SECRET_ACCESS_KEY` | server only | same | |
| `R2_BUCKET_NAME` | server only | — | the private bucket |
| `R2_ENDPOINT` | server only | `https://<account id>.r2.cloudflarestorage.com` | must include `https://` |

`vercel.json` pins the function region to `icn1` (Seoul) so the app runs next to
the Supabase project in `ap-northeast-2`; every page does several round trips and
the distance is the dominant cost.

### 3. Deploy

Vercel builds on push to `main` once the GitHub repository is connected — no
build configuration is needed beyond the environment variables above
(`framework: nextjs` is already declared).

### 4. After deploying

Run the demo scenario of plan section 102 against the production URL: sign in →
dashboard → add a contract → drop a PDF → metadata → save → search "Samsung" →
open the contract → page through the PDF → zoom → edit the expiry date.

Then answer the Wave 1 exit gate (plan section 110); the checklist and the
answers for this repository are in
[`docs/milestones/M8-tests-ci-hardening-deploy.md`](docs/milestones/M8-tests-ci-hardening-deploy.md).

## Database

Schema lives in `supabase/migrations/` and is applied in filename order:

| Migration | Contents |
| --- | --- |
| `…090000_init_updated_at_helper.sql` | `set_updated_at()` trigger function |
| `…090100_create_organizations.sql` | `organizations` + seeded default "HR Partner" |
| `…090200_create_profiles.sql` | `profiles`, `current_organization_id()`, `handle_new_user` + backfill |
| `…090300_create_contracts.sql` | `contracts` + search/expiry indexes |
| `…090400_create_contract_files.sql` | `contract_files` + indexes |
| `…090500_enable_rls_policies.sql` | RLS + policies and grants for all four tables |

Every table is organization-scoped through RLS: a user only reaches rows whose
`organization_id` matches their own profile. `organizations` is read-only for
clients, and `profiles` can only have `full_name` updated by its owner.

## Project structure

```text
app/
  (app)/                # authenticated shell: sidebar layout + protected pages
    layout.tsx
    contracts/          # list, new/, [id]/, actions.ts (server actions)
    dashboard/          # totals + recent/expiring lists
    settings/           # profile, organization, password link, logout + actions.ts
  api/files/upload-url/ # presigned PUT endpoint
  api/files/view-url/   # presigned GET endpoint
  login/                # sign-in page
  auth/                 # reused Supabase auth flows (reset, confirm, error)
components/
  app-sidebar.tsx       # Wave 1 navigation: Tổng quan / Hợp đồng / Cài đặt
  contracts/            # form (create + edit), table, toolbar, pagination,
                        # date-field, detail, edit-sheet, archive-dialog
  dashboard/            # metric-card, recent-contracts, expiring-contracts
  documents/            # upload-dropzone, document-viewer/selector, pdf-*, image-viewer
  settings/             # profile-form
  shared/               # empty-state (one implementation, used everywhere)
  ui/                   # shadcn/ui components
lib/
  auth.ts               # resolveAccess() / requireUser() route protection
  server-action.ts      # authorized() + ActionResult for every server action
  contracts-query.ts    # list URL state + resolveExpiryPreset() (shared with dashboard)
  format.ts             # bytes / dates / days-until helpers
  view-url.ts           # signed view URL + refresh policy (client)
  services/             # contracts.ts (CRUD + list + update + archive),
                        # files.ts, dashboard.ts, profiles.ts, organizations.ts
  r2/                   # client, keys, presign, objects (server-only)
  upload.ts             # XHR PUT with real progress (client-only)
  supabase/             # browser / server / proxy Supabase clients
packages/
  schemas/              # contract.ts, file.ts, profile.ts — shared Zod schemas
supabase/
  migrations/           # schema + RLS, applied in filename order
proxy.ts                # session refresh + unauthenticated redirect
```

## Notes

- `.npmrc` sets `node-linker=hoisted`. Next.js 16 (Turbopack) and the Next.js
  require hook cannot resolve transitive dependencies through the junction
  layout produced by pnpm's default `isolated` linker on Windows
  (`@swc/helpers` fails to resolve). A hoisted `node_modules` fixes it.
- Navigation intentionally shows only three entries — Tổng quan, Hợp đồng,
  Cài đặt (plan section 26). Processing / Review / AI / Partners are out of
  scope.
- `contracts.partner_text` is a plain text column: Wave 1 has no `partners`
  table (plan section 32).
- Search is backed by `pg_trgm` GIN indexes
  (`20261003100000_add_pg_trgm_search_indexes.sql`), which is why `notes` is
  deliberately excluded from the search.
- Database errors never reach the UI as-is: `dbError()` in
  `lib/services/types.ts` logs the driver message server-side and returns a
  generic Vietnamese message, so no SQL detail or constraint name is rendered.
- The dashboard and the contracts list share one definition of "expiring soon"
  (`resolveExpiryPreset()`), so the card count and the filtered list cannot
  disagree.
