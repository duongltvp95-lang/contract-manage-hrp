# M3 — R2 Storage Service Layer (Wave 1)

Task range: `W1-WEB-010` → `W1-WEB-013` (plan sections 14, 21, 36-39, 60-63, 74).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

## Reuse / Custom declaration (plan section 87)

```text
W1-WEB-010  R2 client

Reuse:
  @aws-sdk/client-s3 (S3Client)

Custom:
  env validation, memoised singleton, server-only guard

W1-WEB-011  Object key

Reuse:
  nothing available upstream

Custom:
  buildObjectKey() convention, sanitizeFilename(), uuid validation

W1-WEB-012  Presigned PUT

Reuse:
  @aws-sdk/s3-request-presigner (getSignedUrl + PutObjectCommand)

Custom:
  createUploadUrl() wrapper + TTL policy

W1-WEB-013  Presigned GET

Reuse:
  @aws-sdk/s3-request-presigner (getSignedUrl + GetObjectCommand)

Custom:
  createViewUrl() wrapper + TTL clamping

Schemas

Reuse:
  zod

Custom:
  PresignUploadSchema (file type / size / id business rules)

Part 0 (owner decision)

Reuse:
  base-repo session proxy (createServerClient + getClaims unchanged)

Custom:
  is_active authorization step in proxy.ts
  requireUser() returning CurrentUser
  /auth/disabled page
```

No AWS Signature V4 code was written — signing is entirely the SDK's.

## 1. Files created and what each one owns

| File | Responsibility |
| --- | --- |
| `lib/r2/client.ts` | `createR2Client()` (memoised `S3Client`), `getR2Bucket()`, `getR2Config()`, `resetR2Client()`. Validates that all five `R2_*` variables are present. |
| `lib/r2/keys.ts` | `OBJECT_KEY_PREFIX`, `sanitizeFilename()`, `buildObjectKey()`. Owns the `contracts/{org}/{contract}/{file}/{filename}` convention. |
| `lib/r2/presign.ts` | `createUploadUrl()` (PUT, 600 s), `createViewUrl()` (GET, clamped to 300-900 s), TTL constants. |
| `packages/schemas/file.ts` | `PresignUploadSchema`, `ALLOWED_MIME_TYPES`, `MAX_UPLOAD_SIZE_MB` / `MAX_UPLOAD_SIZE_BYTES`. |
| `lib/auth.ts` | Updated `requireUser()`: now returns `CurrentUser` (adds `organizationId`, `role`, `fullName`) and refuses deactivated accounts. |
| `app/auth/disabled/page.tsx` | Public landing page for a deactivated account. |
| `tsconfig.json` | Added the `@schemas/*` → `./packages/schemas/*` path alias. |
| `.env.example` | Documents every `R2_*` variable and `MAX_UPLOAD_SIZE_MB`; no real values. |

All three `lib/r2/*` modules start with `import "server-only"`, so the build
fails if a Client Component ever imports them. That is the mechanism keeping
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` out of the browser bundle (plan
section 61).

`buildObjectKey()` validates all three ids as UUIDs before composing the key, so
a caller cannot inject `/` or `..` through an id and escape the organization
prefix. `sanitizeFilename()` strips any directory part, keeps Vietnamese
diacritics (`\p{L}`), collapses everything else to `-`, and preserves a
lowercased `[a-z0-9]` extension.

## 2. Smoke test — 4 steps against the real bucket

Executed through a temporary authenticated route handler (`app/api/m3-smoke`,
deleted afterwards) so the real modules ran inside the real Next.js server
runtime. Results:

```jsonc
"keys": {
  "inputFilename": "../..\\Hợp đồng mẫu (bản 1).PDF",
  "sanitizedFilename": "Hợp-đồng-mẫu-bản-1.pdf",
  "objectKey": "contracts/11111111-1111-1111-1111-111111111111/<contract>/<file>/Hợp-đồng-mẫu-bản-1.pdf",
  "matchesConvention": true,
  "noTraversal": true,
  "badUuidRejected": true
},
"schema": {
  "acceptsValidPayload": true,
  "sentinelOrgIdAccepted": true,
  "rejectsWrongMime": true,
  "rejectsWrongMimeMessage": "Định dạng tệp không được hỗ trợ. Chỉ chấp nhận: application/pdf, image/jpeg, image/png",
  "rejectsOversizeFile": true,
  "rejectsOversizeMessage": "Tệp vượt quá giới hạn 50 MB",
  "rejectsBadId": true,
  "maxUploadSizeMb": "50"
},
"step1_upload": { "status": 200, "signedExpiresIn": "600", "expectedTtl": 600 },
"step2_view":   { "status": 200, "bodyMatches": true, "contentType": "application/pdf",
                  "signedExpiresIn": "900", "expectedTtl": 900 },
"step3_public": { "status": 400, "blocked": false },
"step3b_publicAscii": { "status": 400, "blocked": false },
"step4_cleanup": { "deleted": true, "statusAfterDelete": 404, "goneConfirmed": true }
```

| # | Step | Result |
| --- | --- | --- |
| 1 | `createUploadUrl` → PUT | **PASS** — HTTP 200, `X-Amz-Expires=600` |
| 2 | `createViewUrl` → GET | **PASS** — HTTP 200, body byte-identical, `application/pdf`, `X-Amz-Expires=900` |
| 3 | unsigned public URL | **refused**, but with **400** rather than 403 — see below |
| 4 | delete + verify | **PASS** — object deleted, a fresh signed GET then returns 404 |

After the run, `ListObjectsV2` on the bucket reported **0 objects** — nothing was
left behind.

### Why step 3 returned 400, and the stronger evidence

> **Biên bản chính thức (T1 chốt):** public URL bị từ chối (400 `InvalidArgument`
> khi không có auth; 403 `SignatureDoesNotMatch` / `ExpiredRequest` khi chữ ký
> sai/hết hạn) → **không tồn tại đường đọc ẩn danh.**

The brief expected 403. Cloudflare R2 answers **400 `InvalidArgument` /
`Authorization`** when a request carries *no* authentication material at all,
where AWS S3 would answer 403 `AccessDenied`. Both refuse the object; only the
status code differs.

To prove that the refusal is a real signature check and not an accident of the
missing header, a deeper probe was run:

```text
anonymous GET  existing object : 400 InvalidArgument / Authorization
anonymous GET  missing object  : 400 InvalidArgument / Authorization
anonymous LIST bucket          : 400 InvalidArgument / Authorization
anonymous PUT  new object      : 400 InvalidArgument / Authorization
anonymous DELETE object        : 400 InvalidArgument / Authorization

signed GET (valid, 300s)       : 200  -> object content returned
same URL, signature stripped   : 400 InvalidArgument / Authorization
same URL, signature tampered   : 403 SignatureDoesNotMatch
                                 "The request signature we calculated does not
                                  match the signature you provided."
expired signed GET (1s, waited): 403 ExpiredRequest / Request has expired
signed LIST (control)          : 200
```

The 403s for a tampered and for an expired signature are the meaningful result:
the endpoint evaluates the signature and rejects it. Anonymous 400s are the
"No Authorization header present" path.

## 3. Is `hrp-contract` actually private? — **YES, confirmed**

**Proven by test:** the object is not readable without a valid signature.
Anonymous GET (and PUT/DELETE/LIST) never return content, and signatures are
genuinely enforced — tampering yields 403 `SignatureDoesNotMatch`, expiry yields
403 `ExpiredRequest`.

**Confirmed by the owner (Cloudflare dashboard → R2 → `hrp-contract` →
Settings → Public access):**

```text
r2.dev public URL : NONE
custom domain     : NONE
```

Together these close the gap noted earlier: the S3 endpoint
`<account>.r2.cloudflarestorage.com` requires SigV4 for *every* request
regardless of bucket settings, so its 400/403 answers alone would not have ruled
out a separate opt-in public endpoint. The dashboard check does.

**Conclusion: `hrp-contract` is private. There is no anonymous read path to a
contract file.** Every access must go through `createViewUrl()` after
server-side authorization (plan section 73).

## 4. How the S3Client is configured

```ts
new S3Client({
  region: "auto",              // R2 has no real regions
  endpoint: R2_ENDPOINT,       // https://<account>.r2.cloudflarestorage.com
  forcePathStyle: true,        // <endpoint>/<bucket>/<key>
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
```

- `forcePathStyle: true` keeps the bucket in the path rather than as a virtual
  host subdomain. This is the form the credentials were issued for and it avoids
  any DNS dependency on `<bucket>.<account>.r2.cloudflarestorage.com`. The
  presigned URLs produced use it:
  `https://<account>.r2.cloudflarestorage.com/hrp-contract/contracts/...`
- The client is memoised in a module-level variable, because it holds a
  credential provider and an HTTPS agent.
- Credentials come from the environment at first use, never from code.

## Part 0 — deactivated accounts are refused (two layers)

### Layer 1 — `proxy.ts` (session middleware)

An authenticated request is no longer enough. For every path that is not
`/login` or `/auth/*`, the middleware loads the caller's profile and redirects
to `/auth/disabled` when the row is missing or `is_active` is not `true`.

This covers **every** protected path, including `/api/*` route handlers that
never call `requireUser()`, and it produces a **hard 307** rather than a
streamed redirect.

```ts
const isPublicPath =
  pathname.startsWith("/login") || pathname.startsWith("/auth");

if (!user) {
  if (isPublicPath) return supabaseResponse;
  /* 307 -> /login */
}

if (!isPublicPath) {
  const { data: profile } = await supabase
    .from("profiles").select("is_active").eq("id", user.sub).maybeSingle();

  if (!profile || profile.is_active !== true) {
    /* 307 -> /auth/disabled */
  }
}
```

`/auth/disabled` sits under `/auth/*`, which stays public, so there is no
redirect loop: protected page → `/auth/disabled` → (logout) → `/login`.

Cost: one indexed primary-key lookup on `profiles` per authenticated request to
a protected path. The check is deliberately fail-closed — if the profile cannot
be read, the request is refused.

### Layer 2 — `requireUser()`

It also loads the profile, both to enforce the rule for any future caller and
because the pages need `organizationId` / `role` anyway. This is where the typed
`CurrentUser` comes from.

### Verification

```text
== middleware is_active enforcement ==
  PASS  active account: /dashboard 200 (hard, no soft redirect)
  PASS  active account: unknown /api/* falls through the middleware to a 404
  PASS  profile deactivated
  PASS  deactivated: /dashboard is a HARD 307 to /auth/disabled
  PASS  deactivated: /contracts, /settings, / are hard-redirected — 307, 307, 307
  PASS  deactivated: /api/* is now blocked by the middleware too
  PASS  deactivated: /auth/disabled stays reachable (no redirect loop)
  PASS  deactivated: /login stays reachable
  PASS  profile restored
  PASS  reactivated: /dashboard 200 again

================ 10 passed, 0 failed ================
```

Verified against the live database by flipping `profiles.is_active` through
PostgREST with the secret key, then restoring it.

Before this change the page-layer check alone produced a streamed `200` +
`<meta http-equiv="refresh" content="1;url=/auth/disabled">` (because
`requireUser()` runs inside a `<Suspense>` boundary, required by
`cacheComponents: true`). The middleware now answers with a real 307.

## 5. Deviations from the plan / the M3 brief

| # | Deviation | Reason |
| --- | --- | --- |
| 1 | `lib/r2/` at the repository root, not `apps/web/lib/r2/` | The flat layout was chosen in M1 (confirmed with the owner); the monorepo move is still deferred. |
| 2 | `packages/schemas/` created as briefed, with a `@schemas/*` tsconfig alias | The folder does not conflict with the flat app, and it is already in the right place for a later monorepo move. |
| 3 | `z.guid()` instead of `z.uuid()` | ⚠️ `z.uuid()` validates RFC 9562 version/variant bits and **rejects** the seeded default organization id `11111111-1111-1111-1111-111111111111`, which PostgreSQL accepts. `z.guid()` is format-only, matching PostgreSQL. This would have broken contract creation in M4. |
| 4 | Added `forcePathStyle: true` | Not in the brief; needed for stable path-style presigned URLs. |
| 5 | `MAX_UPLOAD_SIZE_MB` is server-only | It has no `NEXT_PUBLIC_` prefix, so a Client Component sees `undefined` and falls back to 50 MB. The schema is authoritative on the server; the upload UI must take the limit from the server response. Documented in the file. |
| 6 | Only `file.ts` in `packages/schemas/` | Plan section 74 also lists `contract.ts`; that belongs to contract CRUD (`W1-WEB-014`). |
| 7 | `requireUser()` return type changed to `CurrentUser` | Needed anyway for M4 (`organizationId`). Backward compatible — `user.email` still works, so no page needed changing. |
| 8 | Added `resetR2Client()` | Test seam only; the app never calls it. |
| 9 | No `export const dynamic = "force-dynamic"` in the smoke route | Next 16 rejects it: *"Route segment config `dynamic` is not compatible with `nextConfig.cacheComponents`"*. Worth remembering for future route handlers. |
| 10 | Bucket is named `hrp-contract`, not `contracts` | Accepted by the owner. The bucket name is configuration; the object key prefix stays `contracts/` (plan section 37). |
| 11 | `D:\HRP-app\R2-contract.txt` has `R2_ENDPOINT=https//...` (missing colon) | Typo in the source file only. `.env.local` uses the correct `https://…` (verified length 65 and a working connection). |
| 12 | `lib/supabase/proxy.ts` now checks `profiles.is_active` and restructured the public-path test into `isPublicPath` | Owner decision (M3). This is a change to reused base-repository middleware, so it is called out explicitly: session handling itself is untouched, one authorization step was appended. |

## Verification summary

```text
R2 smoke test (real bucket)               4/4 steps + key/schema assertions
Anonymous / invalid-auth probe            signature enforcement proven
Bucket left clean                         0 objects
Bucket public access                      none (owner-confirmed in dashboard)
is_active — middleware layer (live DB)    10 passed, 0 failed
pnpm typecheck                            PASS (exit 0)
pnpm lint                                 PASS (exit 0)
pnpm build                                PASS (exit 0) — 13 routes
```

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| `lib/r2/` has `client.ts` + `keys.ts` + `presign.ts`, server-only | ✅ all three start with `import "server-only"` |
| `buildObjectKey()` follows `contracts/{org}/{contract}/{file}/{filename}` | ✅ asserted in the smoke run |
| `createUploadUrl` TTL 10 min; `createViewUrl` TTL 5-15 min | ✅ `X-Amz-Expires` = 600 and 900 |
| `PresignUploadSchema` blocks bad type/size, honours `MAX_UPLOAD_SIZE_MB` | ✅ with Vietnamese messages |
| Smoke test 4 steps PASS | ✅ upload, view, anonymous refused, cleaned up |
| Bucket is private (no public read path) | ✅ S3 endpoint refuses anonymous + owner confirmed no r2.dev URL and no custom domain |
| `requireUser()` blocks `is_active = false` | ✅ verified against the live database |
| `is_active = false` also blocked for `/api/*` | ✅ enforced in `proxy.ts` with a hard 307 |
| typecheck / lint / build still pass | ✅ |

## Accounts

| Email | Role | Purpose |
| --- | --- | --- |
| `duongltvp95@gmail.com` | **admin** | Owner account, created during M3 sign-off. Password issued out-of-band; rotate it after first login. |
| `m1.test@hrpartner.vn` | user | M1 verification account. Delete or rotate before production. |

The `on_auth_user_created` trigger always assigns `role = 'user'`, so the admin
promotion was applied as a separate `profiles.role = 'admin'` update through the
service role. Passwords are deliberately **not** recorded in this repository.

## Follow-ups

- `lib/r2/presign.ts` deliberately does not authorize. Plan section 63 requires
  `getContractFileAccess()` before any `createViewUrl()` call; that service is
  the first task of the upload/detail milestone. `is_active` is already covered
  by the middleware, but **organization ownership of the contract/file must
  still be checked there**.
- Consider generating Supabase types (`supabase gen types typescript`) so
  `profiles` / `contracts` queries stop needing local row type casts.
