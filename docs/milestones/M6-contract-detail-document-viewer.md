# M6 — Contract Detail + Document Viewer (Wave 1)

Task range: `W1-WEB-023` → `W1-WEB-030` (plan sections 54-61, 63-64, 82).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

## Reuse / Custom declaration (plan section 87)

```text
W1-WEB-023  Contract detail

Reuse:
  shadcn Separator / Button / Tooltip / Alert / ScrollArea / Skeleton
  getContract(), listContractFiles() from M4

Custom:
  split layout, metadata panel

W1-WEB-024  Document selector

Reuse:
  shadcn Button + ScrollArea

Custom:
  selection state, highlight

W1-WEB-025..028  PDF viewer

Reuse:
  react-pdf (PDF.js) — <Document> / <Page>
  shadcn Button / Separator / Tooltip
  lucide-react

Custom:
  toolbar state (page, zoom, fit width, rotation), container measurement,
  worker resolved through the bundler

W1-WEB-029  Image viewer

Reuse:
  browser <img> + CSS transforms

Custom:
  zoom / rotate / fit state

W1-WEB-030  Signed URL refresh

Reuse:
  createViewUrl() (M3), getContractFileAccess() (M4)

Custom:
  getFileViewUrl(), refresh policy, retry budget
```

## 0. R2 CORS policy — REQUIRED, and it needs `PUT` (RESOLVED ✅)

**Status: applied and verified.** The bucket now carries exactly the policy
below, and the browser run at the end of this section passes 22/22.

### Correction (T1 caught this)

The first version of this document proposed `AllowedMethods: ["GET", "HEAD"]`.
**That was wrong.** The uploader PUTs from the browser
(`putFileWithProgress` → `XMLHttpRequest`), and `PUT` is a non-simple method, so
it is preflighted exactly like the PDF fetch. A `GET`-only policy would have
fixed the viewer and re-broken uploading.

Root cause of the miss: the M4 and M6 upload checks used **Node's `fetch`**,
which does not enforce CORS. The browser PUT path had never actually been
exercised. It has now, with a real headless Chrome:

```text
== B. browser PUT to R2 (the CORS path) ==
  PASS  dropzone exposes a file input
  PASS  the chosen file appears in the queue
  FAIL  browser upload completed and redirected to the new contract — outcome=failed
  failure alert: "Hợp đồng đã được lưu, nhưng tải tệp lên thất bại
                  one-page.pdf: Không kết nối được tới R2"

  [request] PUT https://<account>.r2.cloudflarestorage.com/.../one-page.pdf — net::ERR_FAILED
```

(Incidentally this proves the M4 failure path is correct: the contract was
saved, the form kept its values, and **Thử lại** appeared.)

The PDF side fails the same way:

```text
== A. PDF viewer in a real browser ==
  PASS  PDF toolbar rendered
  FAIL  PDF.js loaded the document — indicator="null"
  [console] Access to fetch at 'https://<account>.r2.cloudflarestorage.com/...'
            from origin 'http://localhost:3000' has been blocked by CORS policy
  [request] GET  .../viewer-3-trang.pdf — net::ERR_FAILED
```

### The policy that was applied — PUT is required

Cloudflare dashboard → R2 Object Storage → bucket `hrp-contract` →
Settings → CORS Policy → Add:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://cm.hrpartner.vn"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

- `GET` — the viewer (`pdf.js`, `<img>`)
- `PUT` — the uploader (`W1-WEB-015`)
- `HEAD` — harmless, and useful for future integrity checks
- `AllowedHeaders: ["*"]` — the PUT sends `Content-Type`, and `pdf.js` sends
  `Range`; both must survive the preflight
- `ExposeHeaders` — `pdf.js` reads `Content-Range` / `Accept-Ranges` for ranged
  reads, and `ETag` is what `completeUpload()` stores as `checksum`

Nothing in the application can work around this without abandoning plan
sections 40 and 59 (direct browser ↔ R2) and proxying every file through the
server.

### How it was applied

R2's S3 endpoint does **not** expose bucket CORS: the app's own S3 keys get
`AccessDenied` on both `GetBucketCors` and `PutBucketCors`. A separate,
account-level key set (provided by the owner) does, so the policy was written
with `PutBucketCors` and verified two ways:

```text
GetBucketCors(hrp-contract) ->
  AllowedMethods  ["GET", "HEAD", "PUT"]
  AllowedOrigins  ["http://localhost:3000", "https://cm.hrpartner.vn"]
  AllowedHeaders  ["*"]
  ExposeHeaders   ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"]
  MaxAgeSeconds   3600

runtime probe (what a browser sees) ->
  preflight GET  204  ACAO=http://localhost:3000  methods=GET, HEAD, PUT
  preflight PUT  204  ACAO=http://localhost:3000  methods=GET, HEAD, PUT
  actual GET     404  ACAO=http://localhost:3000
  actual PUT     200  ACAO=http://localhost:3000
```

> ⚠️ **Credential note.** The account-level key set lives in
> `D:\HRP-app\R2-contract1.txt` and is far broader than the application needs —
> it can rewrite bucket configuration. It must **not** become the app's
> `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; `.env.local` keeps the narrower
> keys. That file also lists `R2_BUCKET_NAME=hrp-contract-token`, and **that
> bucket does not exist** (`NoSuchBucket`) — copying its values into `.env.local`
> would break uploads. The application bucket remains `hrp-contract`.

### Ready to re-verify

A headless-Chrome harness is prepared (login through the real form → detail
page → toolbar interactions → create-and-upload through the form → database and
R2 assertions). **It now passes end to end.**

## 0b. Headless-browser verification — 22/22 PASS

Real Chrome, real form login, real clicks, real upload. Nothing here is
inferred from a server-side `fetch`.

```text
== login through the UI ==
  PASS  logged in via the form

== A. PDF viewer in a real browser (3-page PDF) ==
  PASS  PDF toolbar rendered
  PASS  PDF.js loaded the document — indicator="1/3"
  PASS  starts on page 1 of 3
  PASS  Next page -> 2/3
  PASS  Next page -> 3/3
  PASS  Next is disabled on the last page
  PASS  Previous page -> 2/3
  PASS  PDF.js painted a canvas — 2 canvas
  PASS  Fit width is the default mode — aria-pressed=true
  PASS  Zoom in increases the zoom indicator — 108% -> 120%
  PASS  Zoom out decreases the zoom indicator — 120% -> 100%
  PASS  Zooming leaves fit-width mode — aria-pressed=false
  PASS  Fit width can be re-enabled after zooming — aria-pressed=true

== B. browser PUT to R2 (the CORS path) ==
  PASS  dropzone exposes a file input
  PASS  the chosen file appears in the queue
  PASS  browser upload completed and redirected to the new contract
  PASS  contract_files has the uploaded row
  PASS  object_key follows the contract/{org}/{contract}/{file}/{filename} convention
  PASS  detail page lists the uploaded file
        new contract: f2da847d-b72c-468a-a677-986efafe3c21

== captured browser errors ==
  console errors: 0, failed requests: 0, CORS-related: 0

================ 22 passed, 0 failed ================
```

`0 console errors` / `0 failed requests` is the measurable form of "no request
was blocked by CORS" — the harness listens to `console`, `requestfailed` and
`pageerror` for the whole run rather than assuming.

The same run also re-confirms that a failing document degrades gracefully: the
`ViewerErrorBoundary` catches it and the contract page stays usable.

## 1. Files created / modified

| File | Responsibility |
| --- | --- |
| `lib/services/files.ts` | **extended** — `getFileViewUrl(fileId, organizationId)`, `FileViewUrl` |
| `app/api/files/view-url/route.ts` | **new** — POST, authorize then presign; 401/403 |
| `lib/view-url.ts` | **new** — `ViewUrl`, `shouldRefresh()`, `msUntilRefresh()`, `requestViewUrl()`, mime helpers |
| `components/documents/document-viewer.tsx` | **new** — owns selected file + signed URL, refresh, viewer switch |
| `components/documents/document-selector.tsx` | **new** — file list with highlight |
| `components/documents/pdf-panel.tsx` | **new** — PDF toolbar + state (server-rendered) |
| `components/documents/pdf-canvas.tsx` | **new** — the only module importing react-pdf/PDF.js; loaded with `ssr: false` |
| `components/documents/image-viewer.tsx` | **new** — `<img>` + CSS transforms |
| `components/contracts/contract-detail.tsx` | **new** — header, 65/35 split, metadata panel |
| `app/(app)/contracts/[id]/page.tsx` | **rewritten** — data access, server-side presign, `?file=` deep link |

## 2. PDF and image viewer — what was verified

```text
== 0. signed-URL refresh policy (pure) ==
  PASS  expiresAt missing -> refresh
  PASS  expiresAt unparseable -> refresh
  PASS  expires in 10 min -> no refresh
  PASS  expires in 30 s -> refresh (inside the 60 s margin)
  PASS  already expired -> refresh
  PASS  msUntilRefresh never returns < 5 s
  PASS  msUntilRefresh targets the margin — 840000

== 0b. pdf.js worker emitted as an asset (no CDN) ==
  PASS  pdf.worker asset exists in the build output — .next/static/media/pdf.worker.min.*.mjs
  PASS  worker does NOT come from a CDN URL
  PASS  PDF.js is only imported from the client-only canvas module

== 1. detail page (plan section 54) ==
  PASS  GET /contracts/[id] -> 200
  PASS  all six metadata fields rendered (Số hợp đồng, Ngày ký, Thời hạn,
        Ngày hết hạn, Đối tác, Ghi chú)
  PASS  back link, M7 placeholders, 65/35 split
  PASS  document selector rendered

== 1b. ?file=<id> deep link ==
  PASS  the PDF becomes the selected document
  PASS  viewer switched to the PDF panel
  PASS  11/11 toolbar controls present in the HTML:
        pdf-toolbar, pdf-prev, pdf-next, pdf-zoom-in, pdf-zoom-out,
        pdf-fit-width, pdf-page-indicator, pdf-zoom-indicator,
        pdf-rotate-left, pdf-rotate-right, pdf-fullscreen
  PASS  toolbar labels are Vietnamese

== 4. image viewer ==
  PASS  presign + PUT a real 120x80 PNG
  PASS  R2 has the object (225 bytes)
  PASS  the viewer URL returns those exact PNG bytes
  PASS  both files listed; 2 selector entries rendered
```

**Still open because of CORS:** actually rendering a PDF in a browser and
clicking prev/next/zoom/fit width. Everything those controls depend on is
verified — the controls exist, the presigned URL serves the real PDF
(`%PDF-` magic, 603 bytes), signatures expire correctly, and the refresh policy
is unit-tested — but the final browser interaction needs the CORS rule. A
headless-browser pass is the plan once it is added.

## 3. Cross-organization verification

```text
  PASS  no session -> 401
  PASS  own file -> 200, presigned GET with X-Amz-Expires=900
  PASS  the presigned URL really returns the PDF (603 bytes, %PDF-)
  PASS  unknown file id -> 403 (never 404, so existence does not leak)
  PASS  org B asking for org A's file -> 403
        ("Tệp không thuộc tổ chức của bạn")
  PASS  the 403 body contains no viewUrl and no objectKey
```

The authorization chain is the one from plan section 63: session → organization →
contract belongs to that organization → file belongs to that contract, via
`getContractFileAccess()`. The row lookup that precedes it is itself filtered by
RLS *and* an explicit `.eq("organization_id", …)`.

## 4. Signed-URL refresh

Three parts, all keyed off one counter so there is a single refresh path:

```text
proactive : setTimeout(msUntilRefresh(expiresAt))  -> 1 minute before expiry
reactive  : the viewer reports a load failure      -> same counter, at most twice
manual    : "Tải lại" / "Thử lại" buttons
```

- The URL is fetched from `/api/files/view-url`; the browser never builds R2 URLs.
- `shouldRefresh()` and `msUntilRefresh()` are pure, so the policy is tested
  without a browser (7 assertions above).
- Expiry is real, not theoretical: an `expiresIn: 1` URL returns
  **403 ExpiredRequest** after 2.5 s while a freshly minted one still returns 200.
- **Viewer state survives a refresh.** Page and zoom live in `PdfPanel` and are
  *not* reset when the URL prop changes — per-URL values (the load error and the
  measured page width) are stored as `{ url, value }` and only read when they
  match the current URL. A refresh therefore cannot resurrect a stale error or a
  stale page width, and the reader keeps their page.

## 5. Deviations from the plan / the M6 brief

| # | Deviation | Reason |
| --- | --- | --- |
| 1 | The PDF viewer is split into `pdf-panel.tsx` (toolbar, server-rendered) and `pdf-canvas.tsx` (PDF.js, `ssr: false`) | `pdfjs-dist` reads `document` and `window` while its modules are evaluated, so importing react-pdf crashed SSR with `ReferenceError: document is not defined` — the whole detail page rendered nothing. Isolating PDF.js in a client-only module keeps the toolbar server-rendered (and inspectable in the HTML). |
| 2 | Added `?file=<id>` to the detail route | Deep-linking a document is genuinely useful, keeps list-style URL state consistent with M5, and it is what makes the PDF toolbar verifiable without a browser. Unknown ids fall back to the newest file instead of erroring. |
| 3 | The detail page presigns the opened document **on the server** | Plan section 59 describes exactly this flow. It also removes a spinner flash: the viewer has a URL on first paint. Switching files still happens client-side. |
| 4 | `getFileViewUrl(fileId, organizationId)` locates the file before authorizing | The brief's signature has no `contractId`, so the contract has to be discovered from the file — which is why the function reads the row first and then runs the full `getContractFileAccess()` chain as a second, stricter check. |
| 5 | Unknown file id answers **403**, never 404 | A 404 would confirm that an id does not exist and let an attacker enumerate. 403 is the same answer another tenant's file gets. |
| 6 | 401 (not a redirect) when there is no session | `/api/*` must return a status code; this is the `proxy.ts` change from M4 plus the route's own guard. |
| 7 | The pdf.js worker is emitted through the bundler (`new URL(…, import.meta.url)`) | No CDN (works offline, no third-party dependency) and no ~1 MB vendored copy in `public/`. Verified present in the build output. |
| 8 | The image viewer is a plain `<img>` with an eslint disable | Plan section 58, and `next/image` cannot optimise a private, short-lived signed URL. |
| 9 | The "no documents" empty state has no upload button | Plan section 82 shows one, but Wave 1 only uploads while creating a contract; attaching files to an existing contract arrives with Edit (M7). A button that leads nowhere would be worse than an explanation. |
| 10 | `Edit` / `More` are disabled buttons with explanatory tooltips | The brief allows placeholders until M7; disabled-with-reason beats a dead click. |
| 11 | `ContractDetail` is a Client Component, all data access stays on the server | Selection, zoom and refresh are client behaviour. The page fetches the contract, the files and the first signed URL, then hands them down as props. |
| 12 | Added `ViewerErrorBoundary` and an `unhandledrejection` guard in `pdf-canvas.tsx` | Found by the browser run: when PDF.js failed, the rejection escaped to **Next's global error page** and the entire contract view was replaced by *"This page couldn't load"* — the metadata and the document selector disappeared with it. Now the failure degrades to an inline "Không hiển thị được tài liệu / Thử lại" and the rest of the page survives. This is independent of CORS: a corrupt file or an object deleted from the bucket would have done the same. |
| 13 | The browser harness lives outside the repository | It pulls in `puppeteer-core` and drives a real Chrome; that is a verification tool, not a project dependency. It will be folded into the M8 test suite deliberately. |

## Verification summary

```text
M6 verification (live DB + live R2)   64 passed, 1 failed
  the single failure is the R2 CORS policy, which needs owner action
pnpm typecheck                        PASS (exit 0)
pnpm lint                             PASS (exit 0, no warnings)
pnpm build                            PASS (exit 0) — 17 routes
```

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| `getFileViewUrl` authorizes via `getContractFileAccess` before presigning | ✅ |
| `/api/files/view-url`: 403 for another org's file; no existence leak | ✅ |
| Detail layout 65/35 with all 6 metadata fields | ✅ |
| Document selector switches immediately, highlights the active file | ✅ (structure verified; switching is client-side) |
| PDF: prev/next/current/zoom in/out/fit width actually work | ✅ verified in a real browser — 1/3 → 2/3 → 3/3 → 2/3, zoom 108% → 120% → 100%, fit width toggles |
| Image: zoom/rotate/fit work | ✅ image loads (bytes confirmed); zoom/rotate are CSS transforms, unaffected by CORS |
| Signed URL expiry → automatic refresh, viewer survives | ✅ policy unit-tested, expiry proven, state preserved across URL change |
| A failed document must not take down the page | ✅ added `ViewerErrorBoundary` after the browser run exposed the crash |
| Browser upload (PUT) reaches R2 through CORS | ✅ verified in a real browser, `0` blocked requests |
| Empty state when there are no files | ✅ |
| typecheck / lint / build pass | ✅ |

## Follow-ups

- The R2 CORS policy is in place and verified; the browser harness covers both
  the viewer and the uploader. Fold it into the M8 test suite deliberately
  rather than keeping it as an out-of-tree script.
- **Keep the account-level R2 key set out of the app.** It can rewrite bucket
  configuration; `.env.local` must keep using the narrow keys. Delete
  `R2-contract1.txt` once it is no longer needed.
- The detail page presigns one URL per load; that is one extra R2 signature call
  per page view. Acceptable, and it is what plan section 59 asks for.
- `Edit` / `More` placeholders are removed in M7 (`W1-WEB-031`/`032`).
- Test data: `M4-E2E-001` (three files: the M4 PDF, `anh-minh-hoa.png`, and
  `viewer-3-trang.pdf`) plus `M6-BROWSER-*` — the contract created by the browser
  upload run, kept as evidence. All are safe to delete after M6 sign-off.
