# BÀN GIAO VỊ TRÍ T1 — DỰ ÁN CONTRACT MANAGER

> Tài liệu dành cho T1 mới tiếp quản. Đọc hết trước khi ra quyết định hay giao việc.
>
> Tiếp quản: 2026-10-05. File này **không** chứa mật khẩu / PAT / service_role / R2 secret.

---

## 1. Vai trò của T1 (Owner) và cách vận hành

- **T1 = Owner**: đọc plan → phân chia thành task → **in 1 prompt mỗi lần giao việc**. Người dùng (chủ dự án) sẽ copy prompt gửi cho **T2** (AI Coding Agent độc lập).
- **T2 = coder**: làm theo prompt, rồi gửi **report**. Người dùng dán report lại cho T1. T1 **review → chốt (duyệt/duyệt kèm lệch) → in prompt tiếp theo**.
- T1 là người **ra quyết định Owner** (scope, cấu trúc dữ liệu, thứ tự ưu tiên, chấp nhận/loại bỏ lệch kỹ thuật). T2 **không được tự ý** đổi quyết định lớn — nhưng khi phát hiện lỗi thật (nhất là bảo mật) thì T2 phải báo rõ và T1 duyệt.
- Nguyên tắc số 1 xuyên suốt: **REUSE FIRST** (base repo → shadcn → library → reference repo → mới custom code).

---

## 2. Tổng quan dự án

- **Tên**: Contract Manager — hệ thống quản lý hợp đồng (nội bộ doanh nghiệp VN).
- **Working dir**: `D:\HRP-app\Contract-mange-hrp`
- **Repo GitHub**: `https://github.com/duongltvp95-lang/contract-manage-hrp` (branch `main`)
- **Production**: `https://contract-manage-hrp.vercel.app`
- **Custom domain** `cm.hrpartner.vn`: **đang hoãn** (xem mục 6).

### Kiến trúc

```
Browser → Next.js (Vercel) → Supabase (Auth + PostgreSQL + RLS)
                            → Cloudflare R2 (file PDF/ảnh, bucket private)
```

- **Stack**: Next.js 16 (App Router, Turbopack, `cacheComponents`), TypeScript, pnpm.
- **Thư viện đã chốt**: shadcn/ui, react-hook-form, zod, react-dropzone, react-pdf (PDF.js), date-fns, lucide-react, Sonner, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Table dùng shadcn Table (server-side sort/filter, chưa cần TanStack). Test: **Vitest + Playwright**.
- **Supabase**: project ref `vohrerrbthbrkwjllnlj`, region `ap-northeast-2` (Seoul), PostgreSQL 17.11. Auth email/password (không public sign-up).
- **R2**: bucket `hrp-contract` (PRIVATE), account `7cb198fcbb0d90e7b902bb69010506b9`.

### Dữ liệu cốt lõi (bảng DB)

`organizations` · `profiles` (role admin/user) · `contracts` (có `partner_id` + `partner_text` fallback) · `contract_files` · `partners` (mới round 2). Có bảng `rate_limit_counters` cho rate-limit.

---

## 3. Trạng thái hiện tại (quan trọng nhất)

### ✅ Wave 1 — ĐÃ XONG, production đã chạy

8 milestone M1→M8 đều hoàn tất + vá 3 lỗ hổng bảo mật:

- M1 Foundation/Auth → M8 Tests/CI/Hardening.
- Production đã **smoke test pass**: Demo Scenario 6/6, Exit Gate mục 110 = **17/17 YES**.
- Wave 1 close: 181 test (102 unit + 40 integration + 39 e2e).

### ✅ Feature round 2 — CODE ĐÃ XONG (3/3 phần), đang ở bước đóng gói

Người dùng yêu cầu thêm 2 tính năng:

1. **Đối tác (Partners)**: danh sách công ty đối tác + hợp đồng đã ký, thêm không giới hạn, **cấm xoá**.
2. **Admin quản lý user** (Settings): admin thêm user khác.

Đã chia 3 phần, **T2 làm xong cả 3**:

- Part 1: Partners DB + services + schemas ✅
- Part 2: Partners UI + tích hợp form hợp đồng ✅
- Part 3: Admin user management ✅

Test sau round 2: **unit 145 · integration 61 · e2e 48** (đều pass, không regression).

### ⏳ ĐANG DỞ: Part 4 — push + CI + redeploy + smoke production

Trình tự còn lại (người dùng + T2 phối hợp):

1. **Người dùng đăng nhập GitHub trực tiếp** trên máy/Cursor (browser / Git Credential Manager / `gh auth login`). **Không** tạo PAT, **không** dán token vào chat.
2. **T2 push** 5 commit local (+ commit `docs/HANDOVER-T1.md` nếu còn untracked) lên `origin/main`. Push thường (`git push`); **cấm** `--force` trừ khi T1 duyệt vì remote đã diverge.
3. **Người dùng thêm `SUPABASE_SERVICE_ROLE_KEY` vào Vercel** (Secret, để chức năng "Thêm user" chạy được trên production).
4. **Người dùng Redeploy Vercel**.
5. **T2 smoke test production** (Demo cũ + luồng Partners + luồng Users) → xoá tài khoản test `test.wave1@hrpartner.vn` → báo cáo.
6. T1 chốt round 2.

### 📦 Git hiện tại (quan trọng — CHƯA PUSH)

**5 commit đang ở LOCAL**, chưa lên GitHub (PAT cũ đã revoke; giờ push bằng login GitHub trên máy):

```
f936724  docs: record the production smoke test result
04460d0  feat(partners): partners table, service layer and search
9a926ac  feat(partners): partner directory UI and contract form integration
8c809cf  docs(partners): reference screenshots
d3d018b  feat(users): administrator-only user management in Settings
```

→ Production đang chạy **code Wave 1** (chưa có tính năng Partners/Users) cho tới khi push + redeploy.

Đối chiếu lúc tiếp quản (2026-10-05): `main...origin/main [ahead 5]`. File này (`docs/HANDOVER-T1.md`) là thay đổi **chưa commit** — T1 quyết định gom vào commit docs khi push Part 4, không tách thành vòng T2 riêng trừ khi người dùng muốn.

### Tài khoản / dữ liệu hiện tại

- **Admin thật**: `duongltvp95@gmail.com` (mật khẩu do người dùng tự đặt, không ai khác biết).
- **Tài khoản test**: `test.wave1@hrpartner.vn` (đã nâng role=admin cho test; mật khẩu random 29 ký tự nằm trong `.env.local`). **Phải xoá sau smoke test round 2.**
- DB/R2 hiện sạch: 0 partner · 0 contract · 0 file · 0 object.

---

## 4. Hạ tầng & tài khoản cần biết

### Credentials (nằm ngoài repo, KHÔNG commit)

| Thứ | Giá trị | Lưu ý |
|---|---|---|
| Supabase URL | `https://vohrerrbthbrkwjllnlj.supabase.co` | public |
| Supabase anon key | `sb_publishable_…` (format mới) | public, client |
| Supabase service_role | `sb_secret_…` (format mới) | **Secret**, server-only |
| R2 account/endpoint | `7cb198fcbb0d90e7b902bb69010506b9` / `https://….r2.cloudflarestorage.com` | |
| R2 access key + secret | trong `D:\HRP-app\R2-contract.txt` (nếu còn) | **Secret** |
| R2 bucket | `hrp-contract` | private |

⚠️ **Key dùng format MỚI** (`sb_publishable_`/`sb_secret_`) — Supabase đang deprecate format cũ. `supabase-js`/`@supabase/ssr` phải bản v2 mới nhất.

### Vercel env (production) — danh sách đầy đủ 11 biến

10 biến đã set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, 5 biến `R2_*`, `APP_URL`, `MAX_UPLOAD_SIZE_MB`. **Còn thiếu `SUPABASE_SERVICE_ROLE_KEY`** (phải thêm ở Part 4). Nhớ: biến `NEXT_PUBLIC_*` đặt kiểu **Config** (không được Secret), biến còn lại đặt **Secret**.

### R2 CORS (đã cấu hình)

Origins: `http://localhost:3000`, `https://contract-manage-hrp.vercel.app`, `https://cm.hrpartner.vn`. Methods `GET/HEAD/PUT`. (Thiếu `PUT` là upload hỏng.)

---

## 5. An ninh / hardening đã áp dụng

- **RLS theo org** + **cấm DELETE qua client** (contracts, contract_files, partners), hợp đồng đã archive bị đóng băng (USING `archived_at IS NULL`).
- **Presign R2 chỉ sau authorize** (`getContractFileAccess`/`getFileViewUrl`), object_key validate theo org/contract/file id, chặn tráo key.
- **Rate limit** 60 req/phút/user qua PostgreSQL (`consume_rate_limit`).
- **Chặn vượt dung lượng**: kiểm tra kích thước THẬT sau upload (HEAD), vượt → xoá object + 422.
- **CORS** đúng origin; bucket R2 private; service_role chỉ server-side.
- Từng có 2 sự cố credential lộ → **đã xử lý**: admin đổi mật khẩu, PAT revoke, R2 admin key revoke. Bài học: **không gửi mật khẩu/key qua chat**.

---

## 6. Việc đang hoãn / sẽ làm sau (optional)

1. **Custom domain `cm.hrpartner.vn`**: DNS của `hrpartner.vn` trỏ nameserver Cloudflare (`charles`/`evelyn`), nhưng zone **không nằm trong account Cloudflare của người dùng** (`duongltvp95@gmail.com` — 0 websites). Các bước khôi phục đã có trong lịch sử: Add a site → CNAME `cm` → `cname.vercel-dns.com` (DNS only) → Vercel add domain. **Đang tạm bỏ qua.**
2. **Wave 2 (OCR/AI)**: plan đã chuẩn bị sẵn boundary (mỗi file có `contract_id + file_id + object_key`; `getFileViewUrl()` cấp URL ký cho Modal/n8n). Chưa có plan chi tiết.
3. Người dùng có thể yêu cầu thêm tính năng (như đã làm round 2).

---

## 7. Tài liệu bắt buộc đọc (theo thứ tự)

1. **`docs/plan/wave1-plan-v1.1.md`** — master plan (MUST READ).
2. **`docs/milestones/*.md`** — báo cáo từng milestone M1→M8 + production smoke (T2 duy trì).
3. **`README.md`** + **`.env.example`** — cách chạy, env.
4. **`supabase/migrations/*.sql`** — schema + RLS + hardening (đặc biệt `…90500_enable_rls_policies.sql`, `…120000_harden_write_paths.sql`, `…100000_add_pg_trgm_search_indexes.sql`, `…0400000_create_partners.sql`).
5. **`tests/`** — hiểu phạm vi test hiện có (unit/integration/e2e).
6. `lib/services/*.ts`, `lib/r2/*.ts`, `lib/contracts-query.ts` — service layer & convention object key.

---

## 8. Gotcha / bài học vận hành (đừng lặp lại)

- **Chạy dev server**: lệnh `pnpm dev` (hoặc double-click `D:\HRP-app\start-dev.bat` — file ngoài repo, chạy không bị watchdog tắt). Job nền chạy từ harness **tự tắt sau 300s idle**.
- **Harness sandbox**: `pnpm dev` cần escalation full-access (lỗi `spawn EPERM` là giới hạn sandbox, không phải lỗi code). `curl` trong sandbox bị chặn TLS (`SEC_E_NO_CREDENTIALS`) — dùng `web_fetch` để kiểm tra URL ngoài.
- **Máy chưa có Node.js độc lập** (chỉ có node đi kèm DSH Desktop); `git` chưa trong PATH (MinGit ở `D:\HRP-app\tools\mingit`).
- **Không xoá `.next` khi `next dev` đang chạy** (làm Turbopack panic).
- **Push code**: người dùng **đăng nhập GitHub trực tiếp** trên môi trường (Cursor / Git Credential Manager / `gh auth login`). Không dùng PAT qua chat. Lịch sử từng phải `--force-with-lease` vì GitHub có commit cũ — **không** lặp lại trừ khi remote diverge và T1 duyệt.
- **CI**: job `quality` (lint/typecheck/test/build) chạy luôn; integration/e2e tự skip nếu thiếu GitHub secrets.
- **Không gửi mật khẩu / PAT / service_role / R2 key qua chat.**

---

## 9. Việc ngay sau khi tiếp quản

1. Đảm bảo **Part 4** hoàn tất: login GitHub trên máy → push 5 commit + handover → thêm `SUPABASE_SERVICE_ROLE_KEY` vào Vercel → redeploy → T2 smoke (Demo + Partners + Users) → xoá `test.wave1@hrpartner.vn`.
2. Chốt Feature round 2.
3. Hỏi người dùng có tiếp tục (nối domain / Wave 2 / tính năng mới) không.
