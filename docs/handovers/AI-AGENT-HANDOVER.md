# BÀN GIAO TOÀN BỘ DỰ ÁN — DÀNH CHO AI AGENT MỚI

> **Ngày tạo:** 2026-10-06
> **Người viết:** T1 (Owner) — đang rời khỏi dự án
> **Người đọc:** AI Coding Agent mới tiếp quản (gọi tắt là "T2 mới" hoặc "bạn")
>
> File này **tự chứa** đủ thông tin để AI mới tiếp tục công việc mà không cần
> hỏi lại T1 cũ. Nếu mâu thuẫn với `docs/HANDOVER-T2.md`, file này ưu tiên hơn.
>
> **QUAN TRỌNG:** File này **không** chứa mật khẩu / PAT / service_role / R2
> secret. Mọi thông tin nhạy cảm nằm trong `.env.local` (do Owner giữ, không
> commit).

---

## 0. TÓM TẮT 30 GIÂY

| Mục | Giá trị |
|---|---|
| **Tên dự án** | Contract Manager (hệ thống quản lý hợp đồng) |
| **Stack** | Next.js 16 + React 19 + TypeScript + Supabase (Postgres + Auth + RLS) + Cloudflare R2 |
| **Owner** | Khương Văn Đường (`duongltvp95@gmail.com`) — tài khoản thật, KHÔNG ĐƯỢC xoá dữ liệu của anh ấy |
| **Repo** | `https://github.com/duongltvp95-lang/contract-manage-hrp`, branch `main` |
| **Production** | `https://contract-manage-hrp.vercel.app` |
| **Local dev** | `http://localhost:3000` (port 3000 là bắt buộc — CORS R2 chỉ cho phép origin này) |
| **DB** | Supabase project chung (URL + service_role key — xem `.env.local`) |
| **Storage** | Cloudflare R2 bucket (3 biến `R2_*` — xem `.env.local`) |
| **Test** | Vitest (unit + integration) + Playwright (e2e) — **chạy trên Supabase + R2 thật**, không mock |
| **Ngôn ngữ giao tiếp** | **TIẾNG VIỆT** (commit message, docs, báo cáo, log; UI người dùng cũng tiếng Việt) |
| **Quy tắc làm việc** | `.cursor/rules/agent-working-rules.mdc` (`alwaysApply: true`) — **ĐỌC FILE NÀY** trước khi nhận việc |

---

## 1. KIẾN TRÚC TỔNG QUAN

```
┌────────────────────────────────────────────────────────────────┐
│ Next.js 16 App Router (src/app)                                │
│   • Server Components mặc định                                 │
│   • Client Components cho form / dialog (Radix UI)             │
│   • Route Handlers / Server Actions cho write                   │
└──────────────────┬─────────────────────────────────────────────┘
                   │
       ┌───────────┼─────────────┐
       ▼           ▼             ▼
  ┌─────────┐ ┌─────────┐  ┌──────────┐
  │ Supabase│ │Supabase │  │ Cloudflare│
  │ Postgres│ │  RLS    │  │    R2     │
  │ + Auth  │ │ policies│  │  bucket   │
  └─────────┘ └─────────┘  └──────────┘
       ↑
   Service role key (.env.local) — bypass policies, dùng cho ops + tests
```

### Thư mục chính

| Đường dẫn | Vai trò |
|---|---|
| `src/app/` | Routes + pages (Next.js App Router) |
| `src/app/admin/` | `/admin/users`, `/admin/logs` — admin-only |
| `src/app/(main)/` | Routes người dùng chính (contracts, partners, settings) |
| `src/components/` | UI components (Radix wrappers + shadcn-style) |
| `lib/services/` | **Business logic** — gọi Supabase + validate với Zod |
| `lib/supabase/` | Client factories: `client.ts` (browser), `server.ts` (server-side), `admin.ts` (service role) |
| `packages/schemas/` | **Zod schemas** — share giữa client + server |
| `supabase/migrations/` | SQL migrations — **file mới nhất = `20261006140000_create_exec_sql.sql`** |
| `tests/unit/` | Vitest unit tests (177/177 pass) |
| `tests/integration/` | Vitest + Supabase thật (3 pre-existing fail do double-encode UTF-8 — xem §7) |
| `tests/e2e/` | Playwright + browser thật |
| `scripts/` | Ops scripts — chỉ giữ scripts tái sử dụng (apply-round5-prod.mjs là 1 ví dụ) |
| `queries/` | KHÔNG commit — chỉ chứa diagnostic scripts dùng 1 lần |
| `docs/` | Handover docs, ops guides, prompt history |

### Stack chi tiết

| Layer | Công nghệ |
|---|---|
| Framework | Next.js **16.3.8**, App Router, React **19**, React Server Components |
| Language | TypeScript **5**, strict mode |
| UI | Radix UI primitives + Tailwind CSS 3 + `lucide-react` icons + `sonner` toast |
| Forms | `react-hook-form` 7 + `zod` 4 + `@hookform/resolvers` |
| Auth + DB | `@supabase/supabase-js` 2.117 + `@supabase/ssr` 0.12 |
| Storage | `@aws-sdk/client-s3` 3 + `s3-request-presigner` (R2 tương thích S3) |
| PDF | `pdfjs-dist` 6 + `react-pdf` 11 |
| Excel export | `exceljs` 4 |
| Date | `date-fns` 4 + `react-day-picker` 10 |
| Test | Vitest 5 + Playwright 1.63 |
| Lint | ESLint 9 + `eslint-config-next` |
| Package manager | **pnpm** (mặc dù `package.json` không enforce — đã dùng `pnpm test:all`) |

---

## 3. TRẠNG THÁI GIT — ĐỌC TRƯỚC KHI LÀM BẤT CỨ VIỆC GÌ

```
$ git log --oneline -5
bb8526b chore(prod): apply round 5 tombstone migration + backfill (round 5.1)
c3fbda6 fix(users): hide tombstone profile from /settings (round 5)
99535fb feat(users): admin hard delete user (round 4)
b6a069e docs: update handovers and lockfile for round 3 (b56a5fd follow-up)
b56a5fd feat(audit): admin user actions, audit log table and admin/logs page (round 3)

$ git status --short
?? AGENTS.md
?? CLAUDE.md
?? docs/prompts/round3-continue.md
?? docs/prompts/round3-finalize.md
?? docs/prompts/round3.md
?? docs/prompts/round4.md
?? docs/prompts/round5.1.md
?? docs/prompts/round5.md

$ git rev-list --left-right --count origin/main...main
0   2   ← main đi trước origin/main 2 commit
```

### Phân tích

| Commit | Trạng thái | Mô tả |
|---|---|---|
| `bb8526b` (HEAD) | **local only, chưa push** | Round 5.1: thêm function `public.exec_sql`, script `apply-round5-prod.mjs`, ops doc cho Owner |
| `c3fbda6` | **local only, chưa push** | Round 5: code lọc `.eq("is_tombstone", false)` trong `listUsers` |
| `99535fb` | **pushed** (origin/main) | Round 4: admin hard delete user (`deleteUser` service + `ensureTombstoneProfile`) |
| `b6a069e` | pushed | Round 3 docs follow-up |
| `b56a5fd` | pushed | Round 3: audit logs + admin user actions |

### Untracked files — KHÔNG ĐƯỢC COMMIT

| File | Quy tắc |
|---|---|
| `AGENTS.md` | **HỎI T1 (Owner) trước khi add**. Có thể đã viết từ round 3, chưa được duyệt |
| `CLAUDE.md` | **HỎI T1 trước khi add**. Cùng lý do trên |
| `docs/prompts/round3*.md` | Prompt history của round 3 — KHÔNG cần commit, có thể xoá hoặc để tạm |
| `docs/prompts/round4.md` | Prompt history của round 4 |
| `docs/prompts/round5*.md` | Prompt history của round 5 + 5.1 — đã có bản "continue" trong `bb8526b` (`docs/prompts/round5.1-continue.md`) |

**Khuyến nghị:** xoá các file `docs/prompts/round{3,4,5}*.md` (trừ `round5.1-continue.md` đã commit) — chúng là bản thảo cũ. NHƯNG **hỏi T1 trước** vì quy tắc nói "không tự đổi quyết định Owner".

### Round 3 trên working tree

Theo handover §0, working tree **đáng lẽ phải có code round 3** (audit logs + admin user actions), nhưng thực tế hiện tại:
- 6 untracked files là **prompt history** (markdown), KHÔNG phải code
- Code round 3 đã được **commit vào `b56a5fd` + `b6a069e`** rồi

→ **Round 3 đã merge xong.** T1 đã verify 48/48 spec trên production (ghi trong `docs/HANDOVER-T2.md`). Bạn không cần làm gì cho round 3.

---

## 4. ROUND 5 + 5.1 — VIỆC CÒN DỞ (đọc kỹ phần này)

### 4.1 Bối cảnh

- **Round 4** (`99535fb`, đã push): Owner có thể **xoá cứng** user từ `/admin/users`. Khi xoá, code tạo **tombstone profile** (profile giả với `id` không tồn tại trong `auth.users`) để giữ referential integrity cho `audit_logs.actor_id` (FK `on delete restrict`). Tombstone có `id = 81c03089-de31-4799-9361-ead99bc525f3` trên production.
- **Round 5** (`c3fbda6`, local): Thêm cột `is_tombstone boolean` vào `profiles`. Code lọc `is_tombstone = false` trong `listUsers` để UI `/admin/users` không hiện dòng tombstone giả.
- **Round 5.1** (`bb8526b`, local): Tạo function `public.exec_sql(text)` (service-role only) + script `scripts/apply-round5-prod.mjs` để apply migration `is_tombstone` lên DB mà không cần Supabase CLI (Owner không có access token).

### 4.2 Migration round 5

File: `supabase/migrations/20261006130000_profiles_is_tombstone.sql` (32 dòng) — **CHƯA apply lên production**.

### 4.3 Migration round 5.1

File: `supabase/migrations/20261006140000_create_exec_sql.sql` (44 dòng — đã có comment nhắc NOTIFY pgrst).

**Trạng thái trên production (xác minh 2026-10-06 bởi Owner):**
- Function `public.exec_sql` **ĐÃ CÓ** trên DB (verify bằng `information_schema.routine_privileges` → 1 row `service_role / EXECUTE`)
- `select public.exec_sql('select 1')` → pass
- **PostgREST schema cache có thể chưa refresh** — nếu gọi qua `supabase.rpc("exec_sql", ...)` mà báo "Could not find the function public.exec_sql(sql) in the schema cache", chạy `NOTIFY pgrst, 'reload schema';` trong SQL Editor rồi thử lại

### 4.4 Việc bạn cần làm để hoàn tất round 5 + 5.1

| # | Bước | Lệnh / cách làm | Kỳ vọng |
|---|---|---|---|
| 1 | Verify `exec_sql` chạy được qua service-role RPC (không qua SQL Editor) | `node scripts/apply-round5-prod.mjs` | Exit 0, in 3 kết quả verify (column có / tombstone `is_tombstone=true` / count = 1) |
| 2 | Nếu bước 1 fail với "schema cache not found" | Chạy `NOTIFY pgrst, 'reload schema';` trong SQL Editor rồi chạy lại bước 1 | Pass |
| 3 | Smoke `/admin/users` production — confirm row tombstone vẫn hiện (vì code round 5 chưa push) | Mở `https://contract-manage-hrp.vercel.app/admin/users` đăng nhập admin | Thấy 1 row "ghost" với `is_active=false` (KHÔNG có badge tombstone — UI chưa biết) |
| 4 | **KHÔNG push** | — | — |
| 6 | Báo cáo về Owner | Báo cáo 5 mục (xem §8) | — |

Sau khi bạn báo cáo xong, **Owner** sẽ tự push `c3fbda6` + `bb8526b` lên `origin/main`, redeploy Vercel, rồi bạn smoke lần 2 để confirm row tombstone biến mất.

### 4.5 Files KHÔNG ĐƯỢC sửa

- `lib/services/users.ts` (đã đúng — round 5 đã merge vào `c3fbda6`)
- `lib/services/audit-logs.ts`
- Bất kỳ file nào trong `tests/integration/users.test.ts` (3 test pre-existing fail do double-encode UTF-8 — xử round riêng)

### 4.6 Tóm tắt các file round 5 + 5.1

| File | Commit | Mục đích |
|---|---|---|
| `supabase/migrations/20261006130000_profiles_is_tombstone.sql` | chưa commit (chờ apply) | Thêm cột `is_tombstone` |
| `supabase/migrations/20261006140000_create_exec_sql.sql` | `bb8526b` | Tạo function `public.exec_sql` |
| `scripts/apply-round5-prod.mjs` | `bb8526b` | Script apply migration qua RPC + backfill tombstone |
| `docs/ops/round5.1-sql-editor.md` | `bb8526b` | Hướng dẫn Owner chạy SQL Editor (đã dùng) |
| `docs/prompts/round5.1-continue.md` | `bb8526b` | Handover cho bạn (T2 mới) |
| `docs/HANDOVER-T2.md` (+10 dòng) | `bb8526b` | Note về round 5.1 |

---

## 5. DATABASE — SCHEMA TỔNG QUAN

### 5.1 Tables (theo thứ tự migration)

| Migration | Table / Object | Mô tả |
|---|---|---|
| `20261003090000_init_updated_at_helper.sql` | function `handle_updated_at()` | Trigger helper set `updated_at = NOW()` |
| `20261003090100_create_organizations.sql` | `organizations` | Multi-tenant. Mỗi user thuộc 1 organization |
| `20261003090200_create_profiles.sql` | `profiles`, function `handle_new_user()`, `default_organization_id()` | Profile user. Trigger tự tạo khi `auth.users` insert |
| `20261003090300_create_contracts.sql` | `contracts` | Hợp đồng |
| `20261003090400_create_contract_files.sql` | `contract_files` | File PDF/ảnh scan cho mỗi hợp đồng |
| `20261003090500_enable_rls_policies.sql` | RLS policies | Tất cả bảng trên đều bật RLS |
| `20261003100000_add_pg_trgm_search_indexes.sql` | Indexes `gin_trgm_ops` | Search partners/contracts theo tên |
| `20261003110000_add_rate_limit.sql` | Rate limit per email per hour |
| `20261003120000_harden_write_paths.sql` | Thêm check constraints + tighten RLS |
| `20261004000000_create_partners.sql` | `partners` | Đối tác |
| `20261005100000_partner_address_tax_code.sql` | Columns `address`, `tax_code` cho partners |
| `20261006090000_create_audit_logs.sql` | `audit_logs`, function `log_audit_event()` | Audit log cho 4 actions (create_user, update_user_role, set_active_user, export_logs) |
| `20261006130000_profiles_is_tombstone.sql` | Column `is_tombstone` cho profiles | **CHƯA apply trên prod** |
| `20261006140000_create_exec_sql.sql` | function `public.exec_sql(text)` | **ĐÃ apply trên prod** |

### 5.2 RLS policies (tóm tắt)

- Mọi table đều bật RLS
- User chỉ thấy row thuộc `organization_id` của mình (`get_my_org_id()`)
- Admin role bypass một số check (vd: list mọi user trong org)
- Service role bypass mọi RLS

### 5.3 Cột quan trọng `profiles`

| Column | Type | Mục đích |
|---|---|---|
| `id` | uuid (FK auth.users.id) | Primary key |
| `organization_id` | uuid | Tenant |
| `full_name` | text nullable | Tên hiển thị |
| `role` | enum `'admin' \| 'user'` | Phân quyền |
| `is_active` | boolean | User thật bị deactivate (vẫn hiện trên UI với badge, khác với tombstone) |
| `is_tombstone` | boolean (default false) | **Mới thêm**, đánh dấu row "ghost" do round 2 xoá user |
| `created_at` / `updated_at` | timestamptz | Auto-populate |

---

## 6. TESTING — HẠ TẦNG & TRẠNG THÁI

### 6.1 Cấu hình

| Suite | Lệnh | Backend | Dữ liệu sau khi chạy |
|---|---|---|---|
| Unit | `npm test` | Không cần (mock) | Không đụng |
| Integration | `npm run test:integration` | **Supabase thật** + service role | Phải về 0 (helper `sweepTestRows()` trong `tests/integration/helpers.ts`) |
| E2E | `npm run test:e2e` | **Supabase + R2 thật** + Playwright | Phải về 0 (helper `sweep()` trong `tests/e2e/helpers.ts`) |
| All | `npm run test:all` | = unit + integration + e2e | — |

### 6.2 Trạng thái hiện tại (xác minh 2026-10-06)

| Suite | Kết quả |
|---|---|
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass |
| `npm test` (unit) | ✅ 177/177 pass, 13 files |
| `npm run test:integration -- users` | ⚠️ 20/24 pass, 3 fail (pre-existing), 1 skipped. **Test round 5 pass**. 3 fail là do file `users.test.ts` bị double-encode UTF-8 (chuỗi expect có dạng `"khÃ´ng thá»ƒ xoÃ¡ chÃ­nh mÃ¬nh"` thay vì `"không thể xoá chính mình"`) — service vẫn trả về đúng tiếng Việt, bug ở file test. Cần fix ở round riêng |
| `npm run test:e2e` | Không chạy trong round 5.1 (T1 đã chạy round 4 và ghi nhận 48/48 pass) |

### 6.3 Tài khoản test BẮT BUỘC

| Thuộc tính | Giá trị |
|---|---|
| Email | `e2e.wave2@hrpartner.vn` |
| Password | 28 ký tự — trong `.env.local` (`TEST_ADMIN_PASSWORD`) |
| `email_confirmed_at` | phải khác null |
| `profiles.role` | `admin` |
| `profiles.organization_id` | `11111111-1111-1111-1111-111111111111` (ORG_A) |
| `profiles.is_active` | `true` |
| `profiles.is_tombstone` | `false` |

Nếu tài khoản **không tồn tại** trên auth.users:
1. **KHÔNG** tạo bằng SQL `insert into auth.users` — Supabase cấm
2. Dùng service role: `auth.admin.createUser({ email, password, email_confirm: true })` → trigger `handle_new_user` tự tạo profile → nâng role lên `admin` → set `organization_id`, `is_active`
3. Ghi email/password vào `.env.local`
4. Verify login thật: `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`

**Chi tiết:** xem `docs/HANDOVER-T2.md` §2.

### 6.4 KHÔNG xoá dữ liệu của `duongltvp95@gmail.com`

Tài khoản Owner là **tài khoản thật**. Mọi code cleanup phải lọc theo prefix `E2ETEST-` / `W1TEST-` / `e2e.user.*`. Tài khoản Owner không có prefix nào trong số này → được bảo vệ.

---

## 7. KNOWN ISSUES / RỦI RO

| # | Vấn đề | Trạng thái | Hành động |
|---|---|---|---|
| 1 | `tests/integration/users.test.ts` 3 test fail do double-encode UTF-8 | Pre-existing (không liên quan round 5.1) | Round riêng, KHÔNG sửa trong round 5.1 |
| 2 | `c3fbda6` + `bb8526b` chưa push | Local only | Owner push sau khi script apply-round5-prod.mjs pass + smoke OK |
| 4 | PostgREST schema cache có thể stale sau khi tạo function mới | Có thể xảy ra | Chạy `NOTIFY pgrst, 'reload schema';` nếu cần |
| 5 | `AGENTS.md`, `CLAUDE.md` chưa được Owner duyệt | Untracked | **DỪNG LẠI hỏi Owner** trước khi add |
| 6 | Working tree có 6 file `docs/prompts/round*.md` (bản thảo cũ) | Untracked | Có thể xoá hoặc giữ — hỏi Owner |
| 7 | Round 5 chưa verify tombstone logic trên production UI | Còn dở | Smoke `/admin/users` sau khi push (xem §4.4) |
| 8 | DB column `is_tombstone` chưa tồn tại trên production | Chưa apply | Script `apply-round5-prod.mjs` sẽ apply khi chạy |

---

## 8. QUY TẮC BÁO CÁO — BẮT BUỘC

Mỗi lần giao việc, báo cáo gồm **5 mục** (theo `.cursor/rules/agent-working-rules.mdc`):

1. **Đã làm** — theo từng bước, kèm commit hash / file đã đổi.
2. **Kết quả kiểm chứng** — lệnh đã chạy + kết quả thật. Không nói "đã xong" mà không có bằng chứng (số test pass/mấy, build pass/fail, dữ liệu về 0 chưa).
3. **Lệch so với prompt** — làm khác chỉ dẫn thì nói rõ và giải thích lý do.
4. **Tự động commit/push?** — **luôn hỏi Owner trước**. Không push khi chưa được duyệt.
5. **Vấn đề còn lại / rủi ro** — kể cả thứ mình không kiểm được.

Về credential: khi xác nhận biến đã set, chỉ in **tên biến + SET/EMPTY/độ dài**, không in giá trị. Phát hiện credential bị lộ → **báo Owner ngay**.

---

## 9. CÁC FILE QUAN TRỌNG CẦN ĐỌC

| File | Mục đích | Độ ưu tiên |
|---|---|---|
| `.cursor/rules/agent-working-rules.mdc` | Quy tắc làm việc bắt buộc | **ĐỌC ĐẦU TIÊN** |
| `docs/HANDOVER-T2.md` | Handover gốc (nhiều chi tiết về tài khoản test, dọn dẹp) | **ĐỌC** |
| `docs/ops/round5.1-sql-editor.md` | Hướng dẫn Owner chạy SQL Editor cho round 5.1 | Đã dùng — không cần đọc nếu đã xong |
| `docs/prompts/round5.1-continue.md` | Handover cho T2 mới (bạn) — round 5.1 | **ĐỌC** |
| `package.json` | Scripts + dependencies | Đã biết qua §2 |
| `supabase/migrations/*.sql` | 14 migrations — đọc để hiểu schema | Khi cần |
| `lib/services/users.ts` | Service xử lý user (create, update, delete, list) — round 4 + 5 | Khi sửa code liên quan |
| `lib/services/audit-logs.ts` | Service ghi audit log — round 3 | Khi cần |
| `lib/supabase/admin.ts` | Service-role client factory | Khi viết script dùng service role |

---

## 10. PHỤ LỤC — ROUND HISTORY

| Round | Scope | Trạng thái |
|---|---|---|
| Wave 1 | Manual contract management (cơ bản) | ✅ Done (`d790c02`) |
| Wave 2.1 | Partners table + service + search | ✅ Done (`04460d0`) |
| Wave 2.2 | Partners directory UI + contract form integration | ✅ Done (`9a926ac`) |
| Wave 2.3 | Admin-only user management in `/admin/users` | ✅ Done (`d3d018b`) |
| Wave 2.4 | Partners address + tax code fields | ✅ Done (`9cdc7c2`) |
| Wave 3 | Audit logs + admin user actions (Create, Edit Role, Activate) | ✅ Done (`b56a5fd` + `b6a069e`), 48/48 e2e pass trên prod |
| Wave 4 | Admin hard delete user + tombstone profile (block self-delete, block last-admin) | ✅ Done (`99535fb`), **đã push**, **chưa smoke round 5 trên prod** |
| Wave 5 | Filter `is_tombstone = false` trong `listUsers` + cột `is_tombstone` | ✅ Code done (`c3fbda6`), migration **chưa apply trên prod** |
| Wave 5.1 | Function `public.exec_sql` + ops script | ✅ Code done (`bb8526b`), **đã apply trên prod** (verified bởi Owner) |
| Wave 6+ | Chưa xác định | — |

---

## 11. LIÊN HỆ VỚI OWNER

- Email: `duongltvp95@gmail.com`
- Tên: Khương Văn Đường
- Khi cần quyết định nghiệp vụ, scope, secret → hỏi Owner
- Khi cần verify trên production (SQL Editor, Dashboard) → Owner là người duy nhất có quyền

---

**Bạn (T2 mới) — checklist khi bắt đầu:**

- [ ] Đọc file này hết (đặc biệt §3, §4, §7, §8)
- [ ] Đọc `.cursor/rules/agent-working-rules.mdc`
- [ ] Chạy `npm install` (hoặc `pnpm install`)
- [ ] Verify `.env.local` có đủ biến (KHÔNG in giá trị — chỉ in tên + SET/EMPTY)
- [ ] Chạy `npm run typecheck && npm run lint` → confirm pass
- [ ] Chạy `npm test` → confirm 177/177 pass
- [ ] Chạy `node scripts/apply-round5-prod.mjs` (theo §4.4)
- [ ] Smoke `/admin/users` production
- [ ] Báo cáo 5 mục cho Owner

**Bạn không cần làm:**

- Round 3 (đã xong)
- Round 4 code (đã xong)
- Fix 3 integration test fail (round riêng)
- Đụng `lib/services/users.ts` (round 5 đã merge)

**Bạn chỉ cần làm:**

- Hoàn tất round 5.1 (chạy script apply + smoke) → báo cáo
- Chờ Owner push + redeploy
- Smoke lần 2 sau redeploy

---

> *"Không có gì quý hơn độc lập, tự do — và không có gì tự do nếu không có dữ liệu sạch."* — câu tagline không chính thức của dự án, do Owner đặt.