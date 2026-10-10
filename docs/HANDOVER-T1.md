# BÀN GIAO VỊ TRÍ T1 — DỰ ÁN CONTRACT MANAGER

> Tài liệu dành cho **T1 mới** tiếp quản. Đọc hết trước khi ra quyết định hay giao việc.
>
> **Lần cập nhật: 2026-10-10** — đã đối chiếu lại toàn bộ với codebase + dữ liệu thật.
> File này **không** chứa mật khẩu / PAT / `service_role` / R2 secret.

---

## 0. TÓM TẮT 1 PHÚT

- **App**: quản lý hợp đồng + danh bạ đối tác cho **HRP / HR VN**.
- **Production**: `https://cm.hrpartner.vn` (chính, đã nối xong) + `https://contract-manage-hrp.vercel.app` (auto-deploy từ `main`).
- **Git**: `main` = `b74faa7` (**round 32 đã merge**), `origin/main` đồng bộ `0 0`, working tree **sạch**.
- **Trạng thái**: Wave 1 + **round 2 → 32 đều đã merge & deploy**. **KHÔNG còn task nào dở.**
- **Việc đầu tiên khi tiếp quản**: đọc §1–§4, rồi chờ Owner giao round tiếp theo.
- **Quy tắc bắt buộc**: `.cursor/rules/agent-working-rules.mdc` (10 điều) — đọc trước khi code.

> ⚠️ **Tài liệu handover cũ đã LỖI THỜI, đừng dùng làm nguồn quyết định.**
> Bảng đối chiếu ở §9 liệt kê chính xác những gì đã sai. Quan trọng nhất:
> handover `docs/handovers/HANDOVER-NEXT-AI-2026-10-10.md` §9 còn ghi *"round 32 CHƯA merge main"* —
> **đã merge rồi** (commit `b74faa7`). Hãy tin `git` trước, tin tài liệu sau.

---

## 1. Vai trò của T1 (Owner) và cách vận hành

- **T1 = Owner/điều phối**: đọc plan → phân tích yêu cầu thành task nhỏ → **in 1 prompt mỗi lần giao việc**.
  Người dùng (chủ dự án) copy prompt gửi cho **T2** (AI Coding Agent độc lập).
- **T2 = coder**: làm theo prompt → gửi **report 5 mục**. Người dùng dán report lại cho T1.
  T1 **review → chốt (duyệt / duyệt kèm lệch) → in prompt tiếp theo**.
- **T1 là người ra quyết định Owner**: scope, cấu trúc dữ liệu, thứ tự ưu tiên, quy ước bảo mật,
  chấp nhận/loại bỏ lệch kỹ thuật. T2 **không tự ý** đổi quyết định lớn.
  Nhưng khi phát hiện lỗi thật (nhất là bảo mật) thì T2 phải báo kèm bằng chứng, T1 duyệt.
- **T1 không tự code thay T2.** Việc của T1 là chốt prompt + review + ra quyết định kỹ thuật
  (reword / merge / squash).
- Nguyên tắc xuyên suốt: **REUSE FIRST** (base repo → shadcn/ui → thư viện → reference repo → custom).

---

## 2. Tổng quan dự án

- **Tên**: Contract Manager — hệ thống quản lý hợp đồng (nội bộ doanh nghiệp VN).
- **Working dir**: `D:\HRP-app\Contract-mange-hrp`
- **Repo GitHub**: `https://github.com/duongltvp95-lang/contract-manage-hrp` (branch `main`)
- **Production**: `https://cm.hrpartner.vn` · fallback `https://contract-manage-hrp.vercel.app`

### Kiến trúc

```
Browser → Next.js (Vercel, region icn1/Seoul) → Supabase (Auth + PostgreSQL + RLS)
                                        → Cloudflare R2 (file PDF/ảnh, bucket private)
```

- **Stack**: Next.js 16.3.8 (App Router, Turbopack, `cacheComponents`), React 19, TypeScript strict, pnpm.
- **Thư viện đã chốt**: Radix/shadcn-style, react-hook-form, zod, react-dropzone, react-pdf (pdfjs-dist 6),
  date-fns, lucide-react, sonner, **exceljs** (import/export Excel),
  `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Test: **Vitest 5 + Playwright 1.63**.
- **Supabase**: project ref `vohrerrbthbrkwjllnlj`, region `ap-northeast-2` (Seoul), PostgreSQL 17.
  Auth email/password (không public sign-up). Key dạng `sb_publishable_` / `sb_secret_`.
- **R2**: bucket `hrp-contract` (PRIVATE), account `7cb198fc…` (xem `.env.local`).

### Dữ liệu cốt lõi

`organizations` · `profiles` (role admin/user + `is_tombstone` + 3 cột màu) · `companies` ·
`partners` · `partner_companies` (junction nhiều–nhiều) · `contracts` · `contract_files` ·
`audit_logs` · `rate_limit_counters`.
Tổng **24 migration** trong `supabase/migrations/`.

---

## 3. TRẠNG THÁI HIỆN TẠI (quan trọng nhất)

### ✅ Wave 1 (M1–M8) — XONG, đã chạy production từ lâu

Auth, tổ chức, CRUD hợp đồng + upload R2, dashboard, settings. 3 lỗ hổng bảo mật đã vá.

### ✅ Round 2 → 32 — ĐÃ XONG HẾT, đã merge & deploy

Tóm tắt 31 round (chi tiết ở `docs/handovers/HANDOVER-NEXT-AI-2026-10-10.md` §6):

| Nhóm | Nội dung |
|---|---|
| **R2–R5** | Đối tác, audit log `/admin/logs`, quản lý user, tombstone profile |
| **R6–R7** | Combobox tìm đối tác (RPC `search_partners`, limit 50) · import Excel (≤500 dòng/5MB) |
| **R8–R9** | Audit 13 action nghiệp vụ + cột người thực hiện |
| **R10–R14** | Trạng thái hợp tác + 2 công ty HRP/HR VN · logo sidebar · 3 bộ màu chủ đạo/nền/sidebar |
| **R15–R18** | Dashboard hiện tên đối tác · khu "Phụ lục hợp đồng" · refresh UI Stripe/Linear · cột Công ty |
| **R19–R20** | **Xoá hợp đồng/đối tác + bỏ lưu trữ + tab "Đã lưu trữ"** (chỉ admin đặc quyền) · 3 tab hợp đồng + 3 tab đối tác |
| **R21–R23** | Khu vực + Tên viết tắt · import đọc cột Trạng thái · **xuất Excel đối tác** (3 scope) |
| **R24–R25** | **Xoá hàng loạt** (cap 100) · import chống trùng 5 khoá (`MST → viết tắt → tên → địa chỉ → khu vực`) |
| **R26–R28** | Cột Tên viết tắt · fix lỗi "không lưu được" (Alert + Thử lại) · bộ lọc Số hợp đồng |
| **R29–R31** | Form tay check trùng MST **theo công ty** · bộ lọc trực tiếp trong header cột · bảng responsive |
| **R32** | Combobox ở form hợp đồng hiện **badge công ty liên kết** (HRP/HR VN/cả hai) |

### 📦 Git hiện tại — đã đồng bộ, KHÔNG có task merge nào dở

```
b74faa7  feat(partners): merge round 32 — partner combobox companies and verification   ← main, origin/main
71789fc  docs: them tai lieu ban giao duan round 32 snapshot 2026-10-10
5e1e269  feat: add script to verify remaining E2E partner count in Supabase
6ba1073  feat(partners): checkpoint round 32 — refactor combobox + tách PartnerOptionRow
36239fa  feat(partners): checkpoint round 32 — gộp 5 file revert + 2 file mới
a0e2cda  feat(partners): company-scoped tax code check and responsive table columns (round 29+31)
```

- `git rev-list --left-right --count origin/main...main` → `0  0`
- Branch `feat/partner-combobox-companies` **đã được merge** (vẫn còn local, có thể xoá cho gọn nếu Owner muốn).
- Working tree **sạch hoàn toàn** — không có file untracked (`.codegraph/` đã vào `.gitignore`).
- **2 commit checkpoint tiếng Anh đã được reword thành tiếng Việt** (xem 5.1e/5.1f — xử lý xong).

### ✅ Các mục "dở dang" trong handover cũ — ĐÃ ĐÓNG

| Mục cũ | Trạng thái thật |
|---|---|
| Thêm `SUPABASE_SERVICE_ROLE_KEY` vào Vercel | ✅ **Đã có** — `.env.local` có biến này, production chạy được |
| Redeploy Vercel | ✅ Đã deploy (round 32 chạy trên production) |
| Smoke production + xoá `test.wave1@hrpartner.vn` | ✅ Xong — tài khoản này **không còn** trong DB (xem §5) |
| Chốt round 2 / round 3 | ✅ Đã chốt, đã merge |
| `AGENTS.md` / `CLAUDE.md` chờ duyệt | ✅ **Đã commit** — đang là workspace rule cho Next.js |
| Xoá `queries/*.cjs` + `scripts/_*.cjs` | ✅ Sạch, không còn file diagnostic lạ |

---

## 4. Hạ tầng & tài khoản

### Credentials (nằm ngoài repo, KHÔNG commit)

Tất cả trong `.env.local` — **đã verify đủ 12 biến, tất cả đều SET**:

| Tên biến | Trạng thái | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SET | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | SET | public, client |
| `SUPABASE_SERVICE_ROLE_KEY` | SET | **Secret**, server-only |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_ENDPOINT` | SET | **Secret** |
| `APP_URL` / `MAX_UPLOAD_SIZE_MB` | SET | |
| `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` | SET | chỉ dùng cho test, **không** đặt lên Vercel |

⚠️ Key dùng format **MỚI** (`sb_publishable_` / `sb_secret_`) — Supabase đang deprecate format cũ.
`supabase-js` / `@supabase/ssr` phải bản v2 mới nhất (hiện 2.117.2 / 0.12.7).

### Vercel env (production) — 10 biến ứng dụng

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, 5 biến `R2_*`, `APP_URL`,
`MAX_UPLOAD_SIZE_MB`, `SUPABASE_SERVICE_ROLE_KEY`.
Biến `NEXT_PUBLIC_*` đặt kiểu **Config** (không được Secret), biến còn lại đặt **Secret**.

Ngoài ra có thể có `DELETE_ADMIN_EMAILS` (xoá hợp đồng/đối tác) — **không set thì fallback về email owner**.
**Không bao giờ set tùy tiện** (xem §7 quy tắc an toàn).

### R2 CORS (đã cấu hình)

Origins: `http://localhost:3000`, `https://contract-manage-hrp.vercel.app`, `https://cm.hrpartner.vn`.
Methods `GET/HEAD/PUT`. (Thiếu `PUT` là upload hỏng.)

---

## 5. Dữ liệu thật (đã verify trực tiếp ngày 2026-10-10 — CHỈ ĐỌC)

| Bảng | Số dòng |
|---|---|
| `organizations` | 1 |
| `profiles` | 4 (đã gồm 1 tombstone) |
| `companies` | 2 (seed **HRP** + **HR VN**) |
| `partners` | **144** (123 `active` · 21 `stopped`) |
| `partner_companies` | 144 |
| `contracts` | **0** (owner đã tự xoá hợp đồng cũ bằng tính năng xoá) |
| `contract_files` | 0 |
| `audit_logs` | **1118** |

### Tài khoản

| Email | Tên | Role | Ghi chú |
|---|---|---|---|
| `duongltvp95@gmail.com` | DUONG | admin | **OWNER — không được đụng.** accent=violet, bg=cream, sidebar=cream (owner tự đổi) |
| `duongamo10300@gmail.com` | test | **user** | User thật đang dùng. ⚠️ Handover cũ ghi "admin" — **đã đổi thành user**, đã cập nhật |
| `e2e.wave2@hrpartner.vn` | E2E Wave 2 Admin | admin | **Tài khoản test BẮT BUỘC — không được xoá.** Mật khẩu trong `.env.local` |
| `tombstone.deleted-user@hrpartner.vn` | [Người dùng đã xoá] | user | Tombstone (round 4/5) — `is_tombstone=true`, có auth user ảo |

⚠️ **Lưu ý**: có **143 dòng audit `delete_user`** nhưng `auth.users` chỉ còn 4 tài khoản →
nhiều tài khoản test đã được xoá dọn qua sweep. Đừng hiểu nhầm là dữ liệu mất.

### Dọn dẹp — ✅ ĐÃ SẠCH

- Đối tác test sót: `E2E%` = **0**, `W1TEST%` = **0** ✅
- Hợp đồng: 0 · File: 0 ✅
- Probe route trong `app/api`: chỉ còn 4 route thật (`files/*`, `admin/logs/export`, `partners/export`) ✅

---

## 6. Quy trình làm việc (user ↔ T1 ↔ T2)

- **Owner** giao yêu cầu bằng **tiếng Việt**. Mỗi round chia thành **task nhỏ**;
  mỗi task = 1 prompt rõ ràng (T1 chốt sẵn: phạm vi, hành vi, label, testid…).
- **T2** nhận prompt → code → báo cáo 5 mục → **KHÔNG push**. T1/Owner push sau khi chốt.
- **Report 5 mục bắt buộc**: (1) đã làm + file + commit · (2) kết quả test THẬT ·
  (3) lệch so với prompt + lý do · (4) commit/push? (**chưa**) · (5) rủi ro.
- Test chỉ dùng prefix `E2ETEST-` / `W1TEST-` + email throwaway `w1test.*@hrpartner.test`.
- **Không tự ý đổi quyết định Owner** — rule §4; phát hiện bug/hồi quy → báo kèm bằng chứng.

---

## 7. Gate (phải xanh trước khi merge/push)

```
typecheck · lint (0 warning) · build · unit · FULL integration · FULL e2e
```

**Số liệu chuẩn (main = `b74faa7`, round 32):**

| Bước | Kết quả đã verify 2026-10-10 |
|---|---|
| typecheck (`tsc --noEmit`) | ✅ PASS — 0 lỗi |
| lint (`eslint .`) | ✅ PASS — 0 lỗi, 0 warning |
| unit | ✅ **272/272 pass** (20 file) |
| build | ✅ **PASS** (chạy với `NEXT_DIST_DIR=.next-verify` — xem §8.2) — 22 route, 0 lỗi |
| integration | ❌ **KHÔNG CHẠY ĐƯỢC** trên máy này — ACL deny chặn `next dev` ở `.next-test` (xem §8.2) |
| e2e | ❌ **KHÔNG CHẠY ĐƯỢC** trên máy này — cùng lý do, `.next-e2e` |

> **Quan trọng**: integration/e2e là 2 bước chưa có bằng chứng nào cho `main` **và** cho thay đổi
> `listContracts`. Số liệu cũ (integration 152/152 · e2e 98/98) là của **trước round 32**.
> Chạy được ở **CI** hoặc sau khi Owner gỡ ACL deny.
> **Không được nói "đã pass" khi chưa chạy** (rule §5).

### CI (GitHub Actions, `.github/workflows/ci.yml`)

3 job: `quality` (lint · typecheck · unit · build, **luôn chạy**) · `integration` ·
`e2e` (Playwright + upload report). Job integration/e2e tự skip khi thiếu secrets.

---

## 8. Gotcha / bài học vận hành (đừng lặp lại)

### 8.1 Môi trường máy Owner (rất dễ mất thời gian)

- **Không có Node.js trong PATH.** Node nằm ở
  `C:\Users\Admin\AppData\Local\Programs\aicoworker\app\nodejs\node.exe` (v22.22.1).
  Bản đó **không kèm npm/npx** → không dùng `npx` được.
- Cách chạy đã xác minh chạy được:
  ```powershell
  $env:PATH = "C:\Users\Admin\AppData\Local\Programs\aicoworker\app\nodejs;$env:PATH"
  & node_modules\.bin\tsc.cmd --noEmit        # typecheck
  & node_modules\.bin\eslint.cmd .            # lint
  & node_modules\.bin\vitest.cmd run --project unit   # unit
  & node_modules\.bin\next.cmd build           # build
  & node_modules\.bin\playwright.cmd test     # e2e
  ```
- Không có `tsx` / `vite-node` → script `.ts` trong `scripts/` **không chạy được bằng node trực tiếp**.
  Muốn chạy script ad-hoc thì viết `.mjs` (đọc `.env.local` bằng `readFileSync` + parse tay).

### 8.2 🐛 Lỗi ACL `EPERM` — chặn `next build`, `next dev`, integration và e2e

**Đây là lỗi MÁY, không phải lỗi code.** Ba thư mục build đều có ACL deny:

```
Get-Acl .next | Select-Object -ExpandProperty AccessToString
→ Everyone  Deny  DeleteSubdirectoriesAndFiles
```

Đã kiểm tra cả 3: **`.next` · `.next-test` · `.next-e2e` đều `CÓ DENY`**.

→ Node **không unlink/rename được file cũ** → build và dev server fail.
Tạo/xoá file **mới** vẫn được (file mới không kế thừa deny).

**Hệ quả thực tế (đã verify 2026-10-10):**

| Lệnh | Kết quả | Lý do |
|---|---|---|
| `next build` (`.next`) | ❌ `EPERM … unlink 'app-path-routes-manifest.json'` | deny `DeleteSubdirectoriesAndFiles` |
| `next dev` (`.next-test`) | ❌ `EPERM … rename 'server-reference-manifest.json.tmp…'` | deny khi rename đè |
| `pnpm test:integration` | ❌ **không chạy được** — global-setup spawn `next dev` vào `.next-test` → exit 1 | như trên |
| `pnpm test:e2e` | ❌ **không chạy được** — tương tự với `.next-e2e` | như trên |
| `next build` vào thư mục mới | ✅ PASS | thư mục mới **không kế thừa** deny |

**Cách vòng cho `build`** (đã dùng và verify PASS):
```powershell
$env:NEXT_DIST_DIR = ".next-verify"; & node_modules\.bin\next.cmd build
```
`next.config.ts` đã hỗ trợ biến này (`distDir: process.env.NEXT_DIST_DIR || ".next"`).

⚠️ **Side-effect phải dọn**: Next **tự thêm** `.next-verify/types/**/*.ts` vào `tsconfig.json`.
Sau khi build xong **phải** xoá `.next-verify/` và sửa lại `tsconfig.json`.
Lưu ý: `git checkout -- tsconfig.json` cũng **fail** vì cùng lỗi ACL (unlink bị chặn) —
phải sửa tay bằng editor rồi `git diff` cho sạch.
*(Đã xảy ra và đã dọn sạch trong lần verify này — `git status` chỉ còn 2 file M có chủ ý.)*

**⚠️ Hệ quả với gate (quan trọng):** vì vậy **trên máy này không thể chạy được integration/e2e**
(cần Next server thật trong `.next-test` / `.next-e2e`).
→ **Integration/e2e phải chạy ở CI (GitHub Actions)** hoặc sau khi Owner gỡ ACL deny.
→ T2 **không được** báo cáo "integration/e2e pass" khi chạy trên máy này —
đây là vi phạm rule §5 (không có bằng chứng thì không được nói pass).

**Cách gỡ (Owner làm trên máy, 1 lần):**
```powershell
# Gỡ deny trên 3 thư mục (cảnh báo: cần quyền Administrator)
icacls ".next" /remove:d Everyone /T /C
icacls ".next-test" /remove:d Everyone /T /C
icacls ".next-e2e" /remove:d Everyone /T /C
```
Sau đó xoá hẳn 3 thư mục để tạo lại sạch:
`Remove-Item .next, .next-test, .next-e2e -Recurse -Force`

> **Đây là hạng mục vận hành nên làm sớm** — nó đang chặn 2/5 bước của gate.

### 8.3 Khác

- **Chạy dev server**: `pnpm dev` (hoặc double-click `D:\HRP-app\start-dev.bat`).
  Job nền từ harness **tự tắt sau 300s idle**.
- **Harness sandbox**: `pnpm`/vitest/playwright cần escalation (EPERM);
  `curl` bị chặn TLS (`SEC_E_NO_CREDENTIALS`) — dùng `WebFetch` để kiểm tra URL ngoài.
- **Git**: MinGit ở `D:\HRP-app\tools\mingit` (không trong PATH).
  Push cần full-access; do T1/Owner push, **AI coding KHÔNG push**.
- **Không xoá `.next` khi `next dev` đang chạy** (Turbopack panic).
- **Đọc file UTF-8 bằng `[System.IO.File]::ReadAllText`** — `Get-Content` đọc CP1252 gây mojibake.
- **Supabase/R2 thỉnh thoảng chậm** → timeout là transient: chạy lại tối đa 2 lần trước khi kết luận hồi quy.
  `partners.spec` từng cần `--testTimeout=180000`.
- **Không gửi mật khẩu / PAT / service_role / R2 key qua chat.**

### 8.4 Quy ước kỹ thuật (đừng "sửa")

- `node_modules` layout **hoisted** (`.npmrc: node-linker=hoisted`) — KHÔNG chuyển sang isolated.
- Root layout có `export const instant = false` (theme server-driven) → route dynamic, không có PPR
  static shell. Chấp nhận.
- `exec_sql(text)` (service-role, `returns void`): **1 statement/call**, chỉ cho ops DDL.
  RPC mới cần `NOTIFY pgrst, 'reload schema';` sau khi tạo.
- Hợp đồng lưu trữ bị RLS "đóng băng" → **unarchive phải dùng service-role**.
- `updatePartner`/`updateContract` = **partial** (chỉ ghi key caller gửi — đừng biến thành full-row update).
- `recordAudit` **swallow lỗi** — không bao giờ chặn nghiệp vụ. Cột `audit_logs.actor_id` FK RESTRICT
  → khi xoá user phải purge audit rows trước (pattern `purgeAuditRowsForUser`).
- Xoá hợp đồng = R2 objects → `contract_files` rows → `contracts` (fail R2 = huỷ toàn bộ).
- `PartnerOptionRow` cancel bằng flag `cancelled` (**không** dùng `AbortController` — đã duyệt ở T1).
- Import Excel: `parsePartnerWorkbook` nhận `ArrayBuffer | Uint8Array`; MIME gate có fallback `.xlsx`.

---

## 9. Bảng đối chiếu — handover cũ SAI Ở ĐÂU

Để T1 mới không bị nhầm, đây là những chỗ lệch giữa tài liệu cũ và thực tế:

| Tài liệu cũ | Nội dung sai | Thực tế |
|---|---|---|
| `HANDOVER-T1.md` (bản cũ) | "Round 3 đang dở, chưa commit" | Round 3–32 **đã merge & deploy** |
| `HANDOVER-T1.md` (bản cũ) | "Thiếu `SUPABASE_SERVICE_ROLE_KEY` trên Vercel" | ✅ Đã có |
| `HANDOVER-T1.md` (bản cũ) | "Phải xoá `test.wave1@hrpartner.vn`" | ✅ Đã xoá, không còn trong DB |
| `HANDOVER-T1.md` (bản cũ) | "Custom domain `cm.hrpartner.vn` đang hoãn" | ✅ **Đã nối xong** — DNS CNAME → `vercel-dns-017.com`, README đã đổi thành production chính |
| `HANDOVER-NEXT-AI-2026-10-10.md` §9 | "Round 32 CHƯA merge main, cần reword 2 commit" | ✅ **Đã merge** (`b74faa7`) + **2 commit đã reword tiếng Việt** |
| `HANDOVER-NEXT-AI-2026-10-10.md` §4 | `duongamo10300@gmail.com` là **admin** | → Hiện là **user** |
| `HANDOVER-NEXT-AI-2026-10-10.md` §4 | **143** đối tác | → **144** (123 active + 21 stopped) |
| `HANDOVER-NEXT-AI-2026-10-10.md` §7 | integration 152/152 · e2e 98/98 cho `main` | Đó là số của **trước** round 32; **chưa verify** cho round 32 |
| Rule workspace §6 | "App cố ý không có chức năng xoá user/đối tác/hợp đồng" | ⚠️ **Đã lỗi thời** — round 19 đã thêm xoá hợp đồng/đối tác (admin đặc quyền); round 4 đã thêm xoá user (tombstone). Rule này nên được Owner cập nhật. |

---

## 10. An toàn — TUYỆT ĐỐI KHÔNG

- **KHÔNG** xoá tài khoản `e2e.wave2@hrpartner.vn` (tài khoản test bắt buộc).
- **KHÔNG** đụng dữ liệu/tài khoản của Owner `duongltvp95@gmail.com`.
- **KHÔNG** sweep 144 đối tác thật.
- **KHÔNG** set `DELETE_ADMIN_EMAILS` trên Vercel — mặc định đã là owner, set sai là mất
  khả năng xoá mà Owner cần.
- **KHÔNG** gửi mật khẩu / PAT / `service_role` / R2 key qua chat.
- Từng có 2 sự cố credential lộ → **đã xử lý** (đổi mật khẩu, revoke PAT, revoke R2 admin key).

---

## 11. Tài liệu bắt buộc đọc (theo thứ tự)

1. **`.cursor/rules/agent-working-rules.mdc`** — quy tắc làm việc (10 điều). Đọc đầu tiên.
2. **`docs/HANDOVER-T1.md` (file này)** — trạng thái hiện tại + đối chiếu handover cũ.
3. **`docs/handovers/HANDOVER-NEXT-AI-2026-10-10.md`** — mô tả chi tiết 32 round + gotcha kỹ thuật.
   Phần "việc cần làm" (§9) **đã cũ** — chỉ đọc để hiểu lịch sử.
4. **`docs/handovers/HANDOVER-NEXT-AI.md`** — handover round 30, giữ làm tham chiếu.
5. **`docs/plan/wave1-plan-v1.1.md`** — master plan gốc (Wave 1).
6. **`README.md`** + **`.env.example`** — cách chạy, biến môi trường.
7. **`supabase/migrations/*.sql`** — 24 migration: schema + RLS + hardening.
8. **`tests/`** — 77 file: unit (20) · integration (27) · e2e (18).
9. `lib/services/*.ts`, `lib/r2/*.ts`, `lib/partner-merge.ts`, `lib/delete-permissions.ts`.

---

## 12. Việc ngay sau khi tiếp quản

**Không có task kỹ thuật nào dở.** Việc của T1 mới:

1. **Đọc** §1–§4 của file này + rule workspace.
2. **Xác nhận** với Owner: có tiếp tục round 33 không, hoặc dừng ở đây.
3. **Nếu Owner muốn verify thêm**: chạy full integration + e2e trên `main` (`b74faa7`) để có số liệu
   thật cho round 32 (hiện mới chỉ verify typecheck/lint/unit/build). Sau đó **bắt buộc** chạy
   `scripts/check-partner-count.ts` để xác nhận đối tác test về 0.
4. **Cập nhật rule workspace §6** — câu "app cố ý không có chức năng xoá" đã lỗi thời từ round 19.
   Cần Owner duyệt vì đây là quy ước nghiệp vụ.
5. **Ý tưởng tương lai** (Owner từng nhắc, chưa làm):
   - Pagination cho Đối tác → khi có thì chuyển bộ lọc client (R30) xuống server.
   - Export CSV (hiện chỉ txt/xlsx).
   - Cảnh báo thực tế khoá "Khu vực" trong chống trùng import (khoá yếu nhất — có thể gộp nhầm
     đối tác cùng miền).
   - Audit cho hành động export đối tác (hiện chưa ghi).
   - Wave 2 (OCR/AI): boundary đã chuẩn bị (mỗi file có `contract_id + file_id + object_key`).