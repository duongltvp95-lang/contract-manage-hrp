# M4 — Contract CRUD + Upload (Wave 1)

Task range: `W1-WEB-014` → `W1-WEB-018` (plan sections 14, 35, 38-48, 62-64, 74-77).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

## Reuse / Custom declaration (plan section 87)

```text
W1-WEB-014  Add Contract form

Reuse:
  React Hook Form + @hookform/resolvers/zod
  shadcn Form / Input / Textarea / Calendar / Popover / Alert / Button / Card
  date-fns (display formatting)

Custom:
  contract fields, Vietnamese copy, expiry-before-signed warning

W1-WEB-015  Uploader

Reuse:
  react-dropzone (drag & drop, accept, maxSize)
  shadcn Progress
  AWS presigner (built in M3)

Custom:
  create -> presign -> PUT -> persist orchestration
  authorization (getContractFileAccess)

W1-WEB-016  Upload progress

Reuse:
  XMLHttpRequest upload progress (plan section 43)
  shadcn Progress

Custom:
  per-file status state machine

W1-WEB-017/018  Create flow + persistence

Reuse:
  Supabase client (RLS applies)

Custom:
  createContract / completeUpload services
  object key flow, HEAD verification, checksum
```

## 1. Files created and what each one owns

| File | Responsibility |
| --- | --- |
| `packages/schemas/contract.ts` | `CreateContractSchema` / `UpdateContractSchema` (all fields optional, dates `YYYY-MM-DD`), `isRealCalendarDate()`, `emptyToNull()`, `getContractWarnings()` |
| `packages/schemas/file.ts` | `ContractFileSchema` (filename / mimeType / fileSize), `UploadUrlRequestSchema`, `CompleteUploadSchema`, `PresignUploadSchema`, `ALLOWED_MIME_TYPES`, `MAX_UPLOAD_SIZE_MB` |
| `lib/services/types.ts` | `ServiceResult` / `ok()` / `err()` / `statusForCode()` |
| `lib/services/contracts.ts` | `createContract()`, `getContract()`, `CONTRACT_COLUMNS` |
| `lib/services/files.ts` | `getContractFileAccess()`, `createUploadRequest()`, `completeUpload()`, `listContractFiles()` |
| `lib/r2/objects.ts` | `headObject()`, `deleteObject()` — new in M4, keeps raw S3 calls out of the services |
| `lib/upload.ts` | `putFileWithProgress()` (XHR + real byte progress), `PendingFile`, `newPendingFile()` |
| `lib/format.ts` | `formatBytes()` — shared by server and client |
| `lib/auth.ts` | Refactored: `resolveAccess()` (returns 3 states), `getCurrentUser()`, `requireUser()` |
| `app/(app)/contracts/actions.ts` | `createContractAction()`, `completeUploadAction()` — server actions |
| `app/api/files/upload-url/route.ts` | `POST` presigned PUT after authorization |
| `components/contracts/contract-form.tsx` | The Add Contract form + create→upload→persist orchestration |
| `components/documents/upload-dropzone.tsx` | Dropzone UI, per-file progress and status |
| `app/(app)/contracts/new/page.tsx` | Hosts the form, passes the server's upload limit down |
| `app/(app)/contracts/[id]/page.tsx` | Placeholder detail: metadata + attached files |
| `app/(app)/contracts/page.tsx` | Placeholder list + "Thêm hợp đồng" entry point |

**Security rule enforced throughout:** `organizationId` and the user id are only
ever read from the session (`resolveAccess()`). Neither the presign request nor
the server actions accept an organization from the client; the schemas
deliberately have no such field.

## 2. Create → upload → persist, end to end

Run against the live Supabase project and the real R2 bucket, signed in as
**`duongltvp95@gmail.com`** (admin, organization "HR Partner").

```text
== UI surface ==
  PASS  GET /contracts/new -> 200
  PASS  form renders "Thêm hợp đồng", "Số hợp đồng", "Ngày ký", "Ngày hết hạn",
        "Thời hạn", "Đối tác", "Ghi chú", "Tài liệu", "Kéo thả tệp"
  PASS  dropzone advertises the 50 MB limit

== 1. create contract ==
  contractId      = 35f5f865-4600-4b41-a828-af135a20c8a9
  organization_id = 11111111-1111-1111-1111-111111111111   <- from the session
  created_by      = 36d8075b-acea-4cf7-b595-6b25eec70498   <- the signed-in user
  PASS  dates stored as DATE (YYYY-MM-DD): 2026-01-15 / 2027-01-14

== 2. POST /api/files/upload-url ==
  fileId    = aefc9231-304e-4c26-8bf3-e1033cd70ee7
  objectKey = contracts/11111111-…/35f5f865-…/aefc9231-…/Hợp-đồng-mẫu-M4.pdf
  PASS  presigned PUT returned, X-Amz-Expires = 600
  PASS  objectKey matches contracts/{org}/{contract}/{file}/{filename}

== 3. PUT to R2 ==
  PASS  200

== 4. persist contract_files ==
  PASS  file_size = 603 (the real object size, read back with HEAD)
  PASS  checksum  = c12d842864782d5d908a0b0352095ddc (R2 ETag)
  PASS  storage_provider = 'r2'

== 5. independent verification ==
  PASS  contract_files has exactly 1 row
  PASS  R2 has the object at that exact key (603 bytes)
  PASS  R2 stored content-type application/pdf
  PASS  GET /contracts/[id] -> 200, page lists "Hợp đồng mẫu M4.pdf"
```

The uploaded PDF is a genuinely valid 603-byte PDF (correct xref offsets), so it
can be used to exercise the react-pdf viewer in M6.

Final state of the shared environment:

```text
organizations  : 1   (HR Partner)
auth users     : 2   (duongltvp95@gmail.com admin, m1.test@hrpartner.vn user)
contracts      : 1   (M4-E2E-001, Samsung, 2026-01-15 -> 2027-01-14)
contract_files : 1
R2 objects     : 1
objects without a DB row : 0
rows without an R2 object: 0
```

### Test data deliberately left behind

`M4-E2E-001` and its one PDF are kept as evidence of a real upload (and as
sample data for M5/M6). To remove them later:

```sql
delete from contract_files where contract_id = '35f5f865-4600-4b41-a828-af135a20c8a9';
delete from contracts       where id           = '35f5f865-4600-4b41-a828-af135a20c8a9';
-- plus the R2 object contracts/11111111-…/35f5f865-…/aefc9231-…/Hợp-đồng-mẫu-M4.pdf
```

## 3. Cross-organization verification — 17/17 PASS

A second organization (`22222222-…`) and a user inside it were created, the
checks were run, then **everything was removed again**.

```text
== cross-organization refusals ==
  PASS  no session -> 401
  PASS  org B requesting org A's contract -> 403
        ("Hợp đồng không thuộc tổ chức của bạn")
  PASS  403 response leaks no presigned URL (no uploadUrl, no objectKey)
  PASS  unknown contract -> 403 (not 404, so existence never leaks)

== control: org B can presign its OWN contract ==
  PASS  org B creates its own contract (organization_id = org B)
  PASS  org B presigning its own contract -> 200
  PASS  ...and org A's contract is still 403 for them

== cleanup ==
  PASS  org B files / contracts / auth user / organization removed
  PASS  only HR Partner remains
  PASS  no orphan profile left behind
```

The control matters: it proves the 403 is a real cross-tenant decision, not a
broken endpoint that refuses everyone.

## 4. Upload failure and retry — 14/14 PASS

Plan section 44 requires the contract to survive a failed upload and the form
data to stay intact. The failure path was reproduced by presigning a file and
never PUTting it:

```text
== expiry earlier than signed date (plan section 47) ==
  PASS  warning produced: "Ngày hết hạn đang sớm hơn ngày ký…"
  PASS  normal order produces no warning
  PASS  contract with expiry < signed is SAVED (the warning does not block)

== upload never reached R2 ==
  PASS  persisting a file that never landed in R2 is refused
        (422 upload_incomplete)
  PASS  no contract_files row was created
  PASS  the contract itself survives the failed upload

== retry the same file ==
  PASS  retry PUT -> 200
  PASS  retry persists the row, same fileId as the presign step
  PASS  exactly one file row now exists

== objectKey must match the contract ==
  PASS  a mismatched objectKey is rejected (422 forbidden)
```

Mechanics:

- `completeUpload()` issues a `HEAD` before inserting. A row pointing at a
  missing object would break the viewer later, so it is refused instead of
  stored. The same HEAD supplies the authoritative `file_size` and the ETag used
  as `checksum`.
- The object key must start with
  `contracts/{organizationId}/{contractId}/{fileId}/`, so a client cannot hand
  back a key belonging to another contract even if it knows one.
- On failure the form keeps the values and the saved `contractId`, and shows
  **"Hợp đồng đã được lưu, nhưng tải tệp lên thất bại"** with a **Thử lại**
  button that re-runs only the failed files. The user is never sent back to an
  empty form.

## 5. Deviations from the plan / the M4 brief

| # | Deviation | Reason |
| --- | --- | --- |
| 1 | `lib/services/` at the repository root, not `apps/web/lib/services/` | Flat layout chosen in M1; the monorepo move is still deferred. |
| 2 | Contract CRUD via **server actions**; only the presign step is a route handler | Plan section 64 explicitly allows this and warns against an unnecessary REST layer. Route handlers cannot be unit-driven the way actions can, but they also cannot answer with a redirect — actions are the better fit for form submits. |
| 3 | `PresignUploadSchema` refactored to `UploadUrlRequestSchema.extend({ organizationId })`, and `UploadUrlRequestSchema` to `ContractFileSchema.extend({ contractId })` | Removes duplicated field rules. M3 behaviour is unchanged; the M4 run re-verified every case (mime, size, guid). |
| 4 | `ContractFileSchema` uses `mimeType` / `fileSize`, not `contentType` / `size` | Matches `contract_files.mime_type` / `file_size` and the existing `PresignUploadSchema`, so one name is used end to end instead of two. |
| 5 | Added `CompleteUploadSchema` | The brief specified only `PresignUploadSchema`; the persist step needs its own validated shape (`fileId`, `objectKey`). |
| 6 | Added `lib/r2/objects.ts` (`headObject`, `deleteObject`) | Keeps raw S3 commands out of the service layer (plan section 62). This is a fourth file in `lib/r2/`. |
| 7 | `completeUpload()` HEAD-verifies and stores the ETag | Uses the `checksum` column the schema already had, and prevents dangling rows. Not requested, but it is what makes "upload failed" detectable server-side. |
| 8 | `objectKey` prefix validation in `completeUpload()` | Not in the brief; closes a key-substitution hole. |
| 9 | `lib/auth.ts` refactored into `resolveAccess()` / `getCurrentUser()` / `requireUser()` | A route handler must answer 401/403, not redirect. `requireUser()` no longer queries the profile twice. |
| 10 | `proxy.ts` now returns **JSON 401/403 for `/api/*`** instead of redirecting to `/login` | Found during verification: an unauthenticated API call was being answered with an HTML 307 to the login page. API clients need a status code. |
| 11 | `app/(app)/contracts/[id]/page.tsx` sets `export const instant = false` | Next 16 with `cacheComponents` refused to build the route: the shared sidebar reads `usePathname()` in a Client Component, and a dynamic route with no `generateStaticParams` cannot prerender a shell. The Next docs name `instant = false` as the way to allow a blocking route. |
| 12 | `useWatch()` instead of `form.watch()` | `form.watch()` trips the React Compiler rule `react-hooks/incompatible-library` (the only lint warning in M4, now gone). |
| 13 | Rejected uploads from react-dropzone are described in Vietnamese in the component | Presentation only; `PresignUploadSchema` remains the authoritative check. |
| 14 | `MAX_UPLOAD_SIZE_MB` is passed from the server page into the client form | It is a server-only variable, so a Client Component would otherwise fall back to the hard-coded default (documented in `packages/schemas/file.ts`). |
| 15 | `formatBytes()` extracted to `lib/format.ts` | It was living in `lib/upload.ts`, which documents itself as client-only, yet the server detail page needs it. |

## Verification summary

```text
M4 end-to-end (live DB + live R2)     32/32 assertions
Cross-organization refusals           17 passed, 0 failed
Failure / retry / warning semantics   14 passed, 0 failed
pnpm typecheck                        PASS (exit 0)
pnpm lint                             PASS (exit 0, no warnings)
pnpm build                            PASS (exit 0) — 16 routes
```

Route output:

```text
├ ƒ /api/files/upload-url
├ ◐ /contracts
├   /contracts/[id]
│ └ ◐ /contracts/[id]
├ ◐ /contracts/new
```

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| `CreateContractSchema` + `ContractFileSchema` shared client/server | ✅ |
| `createContract` stores `organization_id` from the session + `created_by` | ✅ asserted live |
| Flow order: contract → R2 upload → `contract_files` | ✅ asserted live |
| Presigned PUT only after authorization (other org → 403) | ✅ 17/17 |
| Multi-file + real progress + type/size validation | ✅ react-dropzone (multiple) + XHR progress + schema |
| Upload failure keeps the contract and offers Retry | ✅ 14/14 |
| Warning (not a block) when `expiry_date < signed_date` | ✅ |
| typecheck / lint / build pass | ✅ |

## Follow-ups

- `getContractFileAccess()` is in place but **nothing calls `createViewUrl()`**
  yet. The M6 viewer must route every presigned GET through it (plan section 63).
- The `POST /api/files/upload-url` body has no rate limit; a signed-in user can
  request unlimited presigned PUTs. Worth revisiting before production.
- `lib/r2/objects.ts` is currently used only by `completeUpload()`; `deleteObject()`
  is unused until archiving lands.
- The detail page is a placeholder. Plan section 54's 65/35 split viewer and the
  react-pdf toolbar belong to `W1-WEB-023`..`030`.
- Test data (`M4-E2E-001` + one R2 object) is intentionally left behind; see the
  cleanup SQL above.
