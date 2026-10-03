# M8 — Tests + CI + Hardening + Deploy prep (Wave 1)

Task range: `W1-WEB-039` → `W1-WEB-043` (plan sections 85, 96, 100-110).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

> **Status of the last two tasks.** `W1-WEB-042` (production deploy) and
> `W1-WEB-043` (production smoke test) cannot be finished by the coding agent —
> connecting the GitHub repository to Vercel and entering the environment
> variables is the owner's step (Part 0 of this milestone). Everything up to and
> including the deploy preparation is done, and section 8 states exactly what
> remains and how to run it.

## 0. Reuse / Custom declaration (plan section 87)

```text
W1-WEB-039  Authorization tests

Reuse:
  Vitest          — the runner
  @supabase/ssr   — signs in exactly like the app, so the cookie is real
  the real route handlers (/api/files/*)

Custom:
  tests/integration/authorization.test.ts
  tests/e2e/security.spec.ts

W1-WEB-040  RLS tests

Reuse:
  Vitest
  @supabase/supabase-js — talks to PostgREST with each user's own token

Custom:
  tests/integration/rls.test.ts

W1-WEB-041  CI

Reuse:
  GitHub Actions, pnpm/action-setup, actions/setup-node
  the existing lint / typecheck / build scripts

Custom:
  .github/workflows/ci.yml

W1-WEB-042  Production deploy

Reuse:
  Vercel's Next.js auto-detection

Custom:
  vercel.json (region pinning), README deployment section, .env.example

W1-WEB-043  Production smoke test

Reuse:
  Playwright — the same suite, pointed at E2E_BASE_URL
```

Plus `Playwright` for the plan section 100 matrix, chosen by the owner.

## 1. Test framework and what was written

| Suite | Runner | Files | Tests | Needs |
| --- | --- | --- | --- | --- |
| Unit | Vitest | 8 | **94** | nothing |
| Integration | Vitest + live Supabase + a real Next server | 3 | **29** | `.env.local` |
| End-to-end | Playwright + real Chrome | 6 | **39** | `.env.local` |
| | | **17** | **162** | |

### Unit (`tests/unit/`) — pure logic, runs in CI on every push

| File | Covers |
| --- | --- |
| `schemas.contract.test.ts` | real-calendar-date rejection (`2026-02-30`), length limits, trimming, `emptyToNull`, the expiry-before-signing warning, that `organizationId` is stripped rather than honoured |
| `schemas.file.test.ts` | the three allowed MIME types, size ceiling, guid validation, that a client-supplied `organizationId` cannot survive |
| `schemas.profile.test.ts` | `full_name` rules and that `role` / `organizationId` are stripped |
| `contracts-query.test.ts` | URL parsing and fallbacks, `resolveExpiryPreset` windows (plan 69/70), search-term sanitising against a PostgREST `or=()` injection |
| `format.test.ts` | bytes, dates, and `daysUntil` at the boundaries |
| `view-url.test.ts` | `shouldRefresh` / `msUntilRefresh` — the signed-URL refresh policy of plan section 60 |
| `r2-keys-presign.test.ts` | object key convention, path-escape refusal through a filename *and* through an id, TTL clamping into 5-15 minutes |
| `rate-limit-policy.test.ts` | `Retry-After` arithmetic, the `X-RateLimit-*` headers, the 429 body |

### Integration (`tests/integration/`) — live Supabase, real route handlers

`global-setup.ts` starts one Next server on port 3100 with its own build
directory; the tests then drive the real endpoints over HTTP.

- **`rls.test.ts` (12)** — talks to PostgREST with each user's own token, so it
  tests the database policy rather than the application's filtering: SELECT,
  unfiltered SELECT, UPDATE, DELETE and INSERT across tenants; profile isolation;
  the column-grant that stops a `role` escalation; that an organization is only
  visible to its members; that the rate-limit table cannot be read.
- **`authorization.test.ts` (14)** — no session → 401; own file → 200 with real
  R2 bytes; **plan section 101**: another tenant's file → 403 with no `viewUrl`,
  no `objectKey`, no signature and no R2 host in the body; unknown id answered
  identically to another tenant's; presign refused into another tenant's
  contract; malformed JSON → 422; forged MIME type → 422; oversized file → 422;
  a client-supplied `organizationId` ignored.
- **`rate-limit.test.ts` (3)** — 70 concurrent requests produce real 429s with
  `Retry-After`; the other endpoint's bucket is unaffected; a different user has
  their own budget.

### End-to-end (`tests/e2e/`) — real Chrome

`auth`, `contracts`, `upload`, `list`, `viewer`, `security` — see the matrix in
section 2.

## 2. Plan section 100 test matrix

| # | Matrix item | Where |
| --- | --- | --- |
| 1 | Login | `auth.spec.ts` |
| 2 | Logout | `auth.spec.ts` |
| 3 | Create contract | `contracts.spec.ts` |
| 4 | Edit contract | `contracts.spec.ts` (Sheet, shared form) |
| 5 | Archive contract | `contracts.spec.ts` (dialog, soft delete) |
| 6 | Upload PDF | `upload.spec.ts` |
| 7 | Upload JPG | `upload.spec.ts` (multi-file case) |
| 8 | Upload PNG | `upload.spec.ts` (multi-file case) |
| 9 | Upload multiple files | `upload.spec.ts` |
| 10 | Upload progress | `upload.spec.ts` (PUT delayed, progressbar asserted) |
| 11 | Upload retry | `upload.spec.ts` (PUT aborted, then `Thử lại`) |
| 12 | Search number | `list.spec.ts` |
| 13 | Search partner | `list.spec.ts` |
| 14 | Expiry filters | `list.spec.ts` (expired + expiring90 through the real Select) |
| 15 | Pagination | `list.spec.ts` (27 seeded rows, 2 pages) |
| 16 | PDF preview | `viewer.spec.ts` (canvas asserted) |
| 17 | PDF next/previous page | `viewer.spec.ts` |
| 18 | PDF zoom | `viewer.spec.ts` |
| 19 | PDF fit width | `viewer.spec.ts` (mode toggling) |
| 20 | Image preview | `viewer.spec.ts` |
| 21 | Switch document | `viewer.spec.ts` |
| 22 | Expired presigned URL refresh | `viewer.spec.ts` (403 on the object, new URL minted, document recovers) |
| 23 | Cross-org DB access | `security.spec.ts` + `rls.test.ts` |
| 24 | Cross-org R2 access | `security.spec.ts` + `authorization.test.ts` (§101) |

Every row is automated. Nothing in the matrix is verified by hand.

## 3. Results

```text
pnpm typecheck          PASS (exit 0)
pnpm lint               PASS (exit 0, 0 warnings)
pnpm build              PASS (exit 0) — 17 routes
pnpm test               94 passed (8 files)
pnpm test:integration   29 passed (3 files)   — live Supabase + live R2
pnpm test:e2e           39 passed (6 files)   — real Chrome
                        ─────
                        162 automated tests
```

The suites leave nothing behind — verified after a full run:

```text
R2 objects: 0
file rows : 0
contracts : 0
```

(That check found a real gap: the first version of the end-to-end teardown
deleted `contract_files` rows without deleting their objects, leaving four
orphaned objects in the bucket. `purgeContract()` in `tests/e2e/helpers.ts` now
deletes the objects first, and every teardown goes through it.)

### CI (`.github/workflows/ci.yml`)

| Job | Runs | Gate |
| --- | --- | --- |
| `quality` | lint → typecheck → `pnpm test` → build | **always**, on push and pull request; no secret needed |
| `integration` | `pnpm test:integration` | only when the repository has Supabase secrets, and never on a pull request from a fork |
| `e2e` | `pnpm test:e2e` + report artifact | same condition |

Secrets come from GitHub secrets and are written to `.env.local` inside the job,
then removed (`if: always()`). Nothing is hard-coded, and a fork without
credentials gets a green `quality` job instead of a red build it cannot fix.

The `build` step passes placeholder Supabase/R2 values: the build never calls
those services, but the modules read them at import time.

**Not yet executed.** This repository has no GitHub remote in this environment,
so the workflow has not run on GitHub. It is written and reviewed, not proven —
stated plainly rather than implied.

## 4. Rate limiting (W1-WEB-041)

Both file endpoints are limited to **60 requests per minute per user**.

```
user -> proxy.ts (session) -> guardFileApiRequest(bucket)
                              ├── resolveAccess()        no session -> 401
                              ├── consume_rate_limit()   over limit -> 429 + Retry-After
                              └── the endpoint itself
```

### Why a database table and not memory

Vercel runs each request in a fresh, horizontally scaled instance, so an
in-process counter enforces nothing — a burst simply lands on different
instances and each one sees "1 request". The alternatives were considered:

| Option | Verdict |
| --- | --- |
| In-memory `Map` | Free, and useless here. |
| Upstash Redis (`@upstash/ratelimit`) | The common answer, but it adds a third-party vendor, another account and another secret for two internal endpoints. |
| Vercel WAF rate limiting | A paid plan feature, configured outside the repository, and it cannot key on the authenticated Supabase user id. |
| **The database we already run** | **Chosen.** No new dependency, no new secret, one shared counter across every instance, and the counters can be inspected with SQL. |

### How it works

`supabase/migrations/20261003110000_add_rate_limit.sql` adds
`rate_limit_counters (user_id, bucket, window_start, hits)` and
`consume_rate_limit(p_bucket, p_limit, p_window_seconds)`, which does an atomic
`insert … on conflict do update … returning hits` inside a fixed window and
returns `(allowed, remaining, reset_at)`.

- The user id comes from `auth.uid()` **inside** the function. A parameter would
  let any signed-in caller burn somebody else's quota.
- One bucket per endpoint, so hammering the viewer cannot lock out uploading.
- The function prunes windows older than two windows for that caller, so the
  table stays small without `pg_cron`.
- The table has RLS enabled with no policies: it can only be reached through the
  function. A unit-level integration test asserts a normal user reads zero rows.

### The documented trade-off

A **fixed window** lets a caller send up to 2× the limit across a window
boundary. That is accepted for two internal endpoints, and it is why the
alternative — a sliding log — was not worth its complexity here.

### Failure behaviour

If the counter cannot be reached the request is **allowed** and the failure is
logged. The counters live in the same database as the contracts, so a database
outage already means the request would fail a moment later; returning 503 would
turn a transient blip into a full outage of uploads and previews.

## 5. Environment variables for Vercel

Set these in **Vercel → Project → Settings → Environment Variables**, for
Production and Preview. `.env.example` documents each one; `README.md` →
Deployment has the same table with the reasoning.

| Variable | Value | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` (or the anon JWT) | no |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | **yes — bypasses RLS** |
| `APP_URL` | `https://cm.hrpartner.vn` | no |
| `MAX_UPLOAD_SIZE_MB` | `50` | no |
| `R2_ACCOUNT_ID` | Cloudflare account id | **yes** |
| `R2_ACCESS_KEY_ID` | an R2 API token key | **yes** |
| `R2_SECRET_ACCESS_KEY` | its secret | **yes** |
| `R2_BUCKET_NAME` | `hrp-contract` | **yes** |
| `R2_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` | **yes** |

Two things that are not environment variables but are just as easy to miss:

1. **R2 CORS** must allow `GET`, `HEAD` **and `PUT`** from
   `https://cm.hrpartner.vn` (and `http://localhost:3000` for local work). `PUT`
   is not optional — the uploader PUTs from the browser. See
   [M6 section 0](M6-contract-detail-document-viewer.md#0-r2-cors-policy--required-and-it-needs-put-resolved-).
2. **Supabase Auth → URL Configuration** must list
   `https://cm.hrpartner.vn/auth/confirm` and `…/auth/update-password` as
   redirect URLs, or password reset bounces to localhost.

Use the **narrowest** R2 key that can read and write the bucket. An
account-level key can rewrite the bucket's CORS policy, which the application
never needs (this was learned the hard way during M6 — the account-level key that
was used to set CORS has since been deleted locally and must be revoked in
Cloudflare).

## 6. Cleanup (W1-WEB-042)

Run against the live project; before → after:

```text
BEFORE                                     AFTER
contracts : 2                              contracts : 0
files     : 4                              files     : 0
objects   : 30                             objects   : 0
orgs      : ["HR Partner"]                 orgs      : ["HR Partner"]
auth users: ["duongltvp95@gmail.com",      auth users: ["duongltvp95@gmail.com"]
             "m1.test@hrpartner.vn"]
```

- The M1 test account `m1.test@hrpartner.vn` is **deleted**.
- Every contract, file row and R2 object is removed. The object count was much
  higher than the row count because earlier milestone runs had left orphaned
  objects behind; all of them are gone.
- The admin account `duongltvp95@gmail.com` is kept, with its profile intact
  (`full_name = "Dương Lê"`, role `admin`, the production organization).
- The rate-limit counters are cleared.
- The account-level R2 credential file (`D:\HRP-app\R2-contract1.txt`) has been
  **deleted from disk**. The key itself still has to be revoked in the Cloudflare
  dashboard — the S3 API cannot revoke credentials, so that step is the owner's.

## 7. Deviations from the plan / the brief

| # | Deviation | Reason |
| --- | --- | --- |
| 1 | The end-to-end suite runs on port **3000** by default | The R2 bucket's CORS policy names `http://localhost:3000` as an allowed origin, and the browser enforces it on both the upload PUT and the PDF fetch. Running on another port needs that origin added to the bucket policy first. `reuseExistingServer` means a running `pnpm dev` is reused locally, and CI starts its own server with `NEXT_DIST_DIR=.next-e2e`. |
| 2 | `vitest.config.mts` aliases `server-only` to an empty stub | The package deliberately throws outside a React Server Component, which would make every `lib/services/*` and `lib/r2/*` import fail in a test. The guard still applies where it matters: the Next build. |
| 3 | The integration server is started with `NODE_ENV=development` | Found the hard way. Vitest sets `NODE_ENV=test`, and a Next dev server started outside `development` **rejects a valid session** — the suite got 401 for a cookie that the same server accepted when started manually. The same setup also strips empty `NEXT_PUBLIC_*` entries, which would otherwise shadow `.env.local`. |
| 4 | `next.config.ts` reads `NEXT_DIST_DIR` for `distDir` | Next 16 allows one `next dev` per project directory, keyed on the build directory, so the test servers could not start while a developer's dev server was running. Unset in normal use. |
| 5 | `lib/rate-limit.ts` was split into `rate-limit-policy.ts` (pure) and `rate-limit.ts` (server-only) | The pure half — headers, `Retry-After`, the message — is worth unit-testing, but importing it from a module that pulls in the Supabase server client would need a Next request context. |
| 6 | Added `lib/api-guard.ts` | Both file routes had the same session/limit preamble and the same three response shapes. One implementation means a new file route cannot forget either check. |
| 7 | `clampViewTtl` was exported from `lib/r2/presign.ts` | A policy that only exists inside a network call cannot be checked cheaply. |
| 8 | `eslint.config.mjs` ignores `.next-test/`, `.next-e2e/`, `test-results/`, `playwright-report/` | Those are generated bundles. ESLint was reporting ~1 900 errors from build output that is not source. |
| 9 | Added `data-testid="image-zoom-in"` / `image-zoom-out` | The PDF toolbar already had them; without them the image-zoom test had to match on a Vietnamese `aria-label`, which is brittle. |
| 10 | The "expired presigned URL" test makes the object request fail with 403 rather than waiting for a real expiry | The server signs the URL before the page renders, so the expiry window is 15 minutes. Returning the error R2 actually returns for a dead signature exercises the same client path (plan section 60) in seconds. The proactive timer itself is covered by `tests/unit/view-url.test.ts`. |
| 11 | The integration suite creates and destroys its own second tenant | RLS cannot be tested with one organization. The fixture is created in `beforeAll` and removed in `afterAll`, and `createSecondTenant()` asserts the profile really moved — a silently failed move would leave the "other tenant" inside org A and every RLS assertion would pass for the wrong reason. (It did exactly that on the first run.) |

## 8. Wave 1 Exit Gate — plan section 110

Answers are based on the automated suites running against the **real Supabase
project and the real R2 bucket**. The production deploy is the owner's step and
has not happened yet, so the last column says what is still outstanding.

| # | Question | Answer | Evidence |
| --- | --- | --- | --- |
| 1 | Can users login? | **YES** | `auth.spec.ts` signs in through the form; `authorization.test.ts` proves an unauthenticated call gets 401 |
| 2 | Can users create contracts? | **YES** | `contracts.spec.ts` creates one and reads it back from the database |
| 3 | Can users upload PDFs/images? | **YES** | `upload.spec.ts` — PDF, PNG, JPG, several at once, through the form and straight to R2 |
| 4 | Are files stored privately in R2? | **YES** | M3 minute (unsigned and mis-signed requests refused); `viewer.spec.ts` renders through a presigned URL only |
| 5 | Can contracts have multiple files? | **YES** | `upload.spec.ts` multi-file case; `viewer.spec.ts` shows two documents and switches between them |
| 6 | Can users search by number? | **YES** | `list.spec.ts` |
| 7 | Can users search by partner? | **YES** | `list.spec.ts` |
| 8 | Can users filter expiry dates? | **YES** | `list.spec.ts` — expired and expiring-90 |
| 9 | Can users preview documents without downloading? | **YES** | `viewer.spec.ts` — canvas painted in the browser |
| 10 | Does PDF navigation work? | **YES** | `viewer.spec.ts` — 1/3 → 2/3 → 3/3 → 2/3, next disabled on the last page |
| 11 | Does zoom work? | **YES** | `viewer.spec.ts` — zoom in/out and fit-width mode, PDF and image |
| 12 | Can users edit metadata? | **YES** | `contracts.spec.ts` — Sheet, expiry changed, detail and list follow |
| 13 | Does RLS isolate organizations? | **YES** | `rls.test.ts` (12 assertions at the PostgREST layer) + `security.spec.ts` in the browser |
| 14 | Does R2 access require application authorization? | **YES** | `authorization.test.ts` §101 — 403 with **no** R2 URL for another tenant's file |
| 15 | Does every file have `contract_id` + `file_id` + `object_key`? | **YES** | Plan section 99 contract; asserted in `upload.spec.ts` and `seedContractWithFile` |
| 16 | Can Wave 2 generate a presigned URL for Modal? | **YES** | `getFileViewUrl()` is the same call the viewer uses; the M6 report documents the TTL window |
| 17 | Did the coding agent reuse approved repos/libraries instead of rebuilding common infrastructure? | **YES** | Every milestone report carries a Reuse/Custom table; `pnpm test:e2e` additionally asserts reuse at runtime (react-dropzone, react-pdf, shadcn, RHF, Zod, AWS SDK) |

**One honest caveat.** Answers 1-17 are verified against the real backend from a
local server. The plan's exit gate asks them of Wave 1 as a product, and the
production domain has not been deployed or smoke-tested yet. Until the owner
completes section 9, the correct reading is "verified, not yet in production".

## 9. What remains (owner)

1. **Revoke the account-level R2 key** in Cloudflare → R2 → Manage R2 API Tokens.
   The local copy has been deleted; the credential itself is still valid.
2. **Push to GitHub** and **connect the repository to Vercel**.
3. **Set the environment variables** from section 5 (Production and Preview).
4. **Add the production origin to the R2 CORS policy** and to the Supabase Auth
   redirect URLs.
5. **Run the plan section 102 demo scenario** against `https://cm.hrpartner.vn`.
   The same Playwright suite can do most of it:

   ```bash
   E2E_BASE_URL=https://cm.hrpartner.vn pnpm test:e2e
   ```

   Note that this writes to the production database — the suite cleans up after
   itself (verified: zero contracts, zero files, zero objects), but it does
   create rows while it runs.

## 10. Acceptance criteria

| Criterion | Status |
| --- | --- |
| `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) run and pass | ✅ 94 + 39 |
| CI runs lint / typecheck / build / test | ✅ written; not yet executed on GitHub (no remote here) |
| Rate limiting works, 429 when exceeded | ✅ 60/min per user via PostgreSQL; real 429s asserted |
| The section 100 matrix is covered automatically | ✅ all 24 rows |
| Cross-org DB **and** R2 are blocked by automated tests | ✅ `rls.test.ts`, `authorization.test.ts`, `security.spec.ts` |
| Cleanup done: no leftover test accounts or data | ✅ admin only; 0 contracts / files / objects |
| Deploy docs + the full environment list | ✅ README → Deployment, `.env.example`, section 5 |
| Production deploy and smoke test | ⏳ **owner step** — section 9 |
