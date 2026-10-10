# BÀN GIAO TOÀN BỘ DỰ ÁN — CHO AI MỚI (snapshot 2026-10-10)

> Tài liệu này là nguồn sự thật duy nhất để một AI Coding Agent mới tiếp quản dự án.
> Repo: `D:\HRP-app\Contract-mange-hrp` (GitHub: `duongltvp95-lang/contract-manage-hrp`).
> Ngày handover: **2026-10-10** (UTC+7).
> Handover cũ (`docs/handovers/HANDOVER-NEXT-AI.md` — HEAD `e64bdb3` round 30) **giữ nguyên** làm tham chiếu lịch sử, KHÔNG đè.

---

## 0. TÓM TẮT 1 PHÚT (đọc đầu tiên)

- **App**: Contract Manager — quản lý hợp đồng + danh bạ đối tác cho HRP / HR VN.
  Production: `https://cm.hrpartner.vn` + `https://contract-manage-hrp.vercel.app`.
- **Stack**: Next.js 16.3.8 App Router (Turbopack) + React 19 + TypeScript strict + pnpm + Supabase (Postgres 17 + Auth + RLS) + Cloudflare R2.
- **Test thật**: Vitest (unit + integration đánh Supabase/R2 thật) + Playwright e2e Chrome thật.
- **Trạng thái hiện tại**: round 1–30 + round 29+31 ở `main` (`a0e2cda`); **round 32 trên branch riêng `feat/partner-combobox-companies` (`2b35d53`) — CHƯA merge vào main**.
- **Việc cần làm NGAY khi tiếp quản** (xem §9):
  1. Reword 2 commit checkpoint `f0636a8` + `8644a95` (tiếng Anh → tiếng Việt) trên branch `feat/partner-combobox-companies` (chưa merge, reword an toàn).
  2. Verify full gate trên branch đó (build/typecheck/lint/unit/integration/e2e + sweep).
  3. Merge `--no-ff` vào `main` + push.
- **Đọc rule trước khi code**: `.cursor/rules/agent-working-rules.mdc` (10 điều, đặc biệt §1 tiếng Việt, §6 dọn dẹp).

---

## 1. DỰ ÁN LÀ GÌ

**Contract Manager (Quản lý hợp đồng)** — app quản lý hợp đồng + danh bạ đối tác cho công ty **HRP / HR VN**.
Production: `https://cm.hrpartner.vn` (chính) và `https://contract-manage-hrp.vercel.app` (Vercel auto-deploy từ `main`).

## 2. STACK

- **Next.js 16.3.8** App Router (Turbopack), React 19, TypeScript strict, pnpm.
- Tailwind + shadcn-style (Radix) UI, lucide-react, sonner (toast), react-hook-form + zod, date-fns, **exceljs** (import/export Excel), `@aws-sdk/client-s3` (R2 presign/upload).
- **Supabase** (Postgres 17 + Auth + RLS), project ref `vohrerrbthbrkwjllnlj`, region ap-northeast-2. Keys dạng `sb_publishable_*` / `sb_secret_*` trong `.env.local`.
- **Cloudflare R2** bucket `hrp-contract` (private, S3-compatible) — lưu file hợp đồng.
- Test: **Vitest** (unit + integration đánh Supabase/R2 THẬT) + **Playwright** e2e (Chrome thật). CI: GitHub Actions (`quality` job luôn chạy; integration/e2e tự skip khi thiếu secrets).

## 3. QUY ƯỚC BẮT BUỘC (đọc kỹ trước khi code)

> Tóm tắt; đầy đủ ở `.cursor/rules/agent-working-rules.mdc`. Khi xung đột, file rule thắng.

- **REUSE FIRST** — tái dùng pattern/service có sẵn, không copy logic. Thứ tự: base repo → shadcn/ui → thư viện có sẵn → reference repo → custom.
- **Tiếng Việt** trong UI, audit, báo cáo, docs; commit message tiếng Việt (rule workspace §1), tên hàm/biến/thuật ngữ kỹ thuật giữ nguyên.
- **Không rò rỉ credential** (báo cáo chỉ nêu tên biến + trạng thái SET/EMPTY/độ dài).
- **RLS org isolation**: mọi truy vấn theo `organization_id = current_organization_id()`.
- **Không có DELETE client-side** cho contracts/partners/files — chỉ service-role (hardening). Ngoại lệ: admin đặc quyền qua service (xem §9 R19).
- Hợp đồng lưu trữ bị RLS "đóng băng" (`using(... and archived_at is null)`) → **unarchive phải dùng service-role**.
- `exec_sql(text)` (service-role, `returns void`): **1 statement/call**, chỉ cho ops DDL; hàm `returns void` KHÔNG trả được SELECT qua `rpc`.
- RPC mới cần `NOTIFY pgrst, 'reload schema';` sau khi tạo.
- `node_modules` layout **hoisted** (`.npmrc: node-linker=hoisted`) — KHÔNG chuyển sang isolated (đã từng làm hỏng build/pdfjs).
- Root layout có `export const instant = false` (theme server-driven: `data-accent`/`data-background`/`data-sidebar`) → route dynamic, không có PPR static shell — chấp nhận, đừng "sửa".
- Supabase/R2 **thỉnh thoảng chậm** → integration/e2e timeout là transient: chạy lại tối đa 2 lần trước khi kết luận hồi quy. `partners.spec` từng cần `--testTimeout=180000`.
- **KHÔNG BAO GIỜ**: xoá user `e2e.wave2@hrpartner.vn` (tài khoản test bắt buộc, admin), đụng dữ liệu thật của owner, set `DELETE_ADMIN_EMAILS` trên Vercel.
- **Không tự ý đổi quyết định Owner** — rule §4; phát hiện lỗi → báo T1 kèm bằng chứng, đề xuất phương án, không tự sửa im lặng. Được phép tự quyết: sửa typo, lint, test, refactor nội bộ không đổi hành vi.
- **Báo cáo 5 mục** sau mỗi task: (1) đã làm + file + commit; (2) kết quả test THẬT; (3) lệch + lý do; (4) commit/push? (**chưa**); (5) rủi ro.

## 4. TÀI KHOẢN / DỮ LIỆU THẬT (tuyệt đối không đụng khi test)

| Đối tượng | Giá trị | Ghi chú |
|---|---|---|
| Owner | `duongltvp95@gmail.com` — profile "DUONG", admin | accent=violet, background=cream, sidebar=cream (do owner tự đổi) |
| User thật đang dùng | `duongamo10300@gmail.com` (admin) | đang hoạt động thường xuyên |
| Tài khoản test | `e2e.wave2@hrpartner.vn` — "E2E Wave 2 Admin", admin | password trong `.env.local` — **không được xoá** |
| Đối tác | **143 đối tác thật** + 143 row junction `partner_companies` | dữ liệu owner, không được sweep |
| Công ty | `companies`: chỉ 2 dòng seed **HRP** + **HR VN** | |
| Hợp đồng | hiện **0** (owner đã tự xoá 2 hợp đồng cũ bằng tính năng xoá — hành động chủ động của owner, ghi trong audit) | |

## 5. CẤU TRÚC QUAN TRỌNG

```
docs/plan/wave1-plan-v1.1.md          # master plan gốc (Wave 1)
docs/HANDOVER-T2.md + docs/handovers/AI-AGENT-HANDOVER.md   # handover cũ (còn giá trị tham khảo)
docs/handovers/HANDOVER-NEXT-AI-2026-10-10.md  # HANDOVER HIỆN TẠI (file này)
docs/prompts/round*.md                # prompt giao việc từng round
.cursor/rules/agent-working-rules.mdc # quy tắc làm việc T2
lib/services/{contracts,partners,files,users,audit-logs,dashboard,organizations,profiles}.ts
lib/partner-merge.ts                  # round 25: 5-khoá chống trùng + ghi đè (chỉ import)
lib/partner-import.ts                 # parse Excel (cột: Tên/Địa chỉ/MST/Khu vực/Tên viết tắt/Công ty/Trạng thái)
lib/partner-display.ts                # foldText, partnerDisplayName, PARTNER_SEARCH_LIMIT=50
lib/theme-{accents,backgrounds,sidebars}.ts   # preset màu (6 mỗi loại)
lib/delete-permissions.ts             # canDeleteEntities + BULK_DELETE_LIMIT=100 (env DELETE_ADMIN_EMAILS, mặc định owner)
packages/schemas/*.ts                 # zod schemas dùng chung (partner, contract, file, audit-log, theme, profile…)
app/(app)/{dashboard,contracts,partners,admin/logs,settings}
app/api/files/*                       # presign + complete upload
app/api/admin/logs/export/route.ts    # export nhật ký txt/xlsx
app/api/partners/export/route.ts      # round 23: export đối tác 3 scope
components/{contracts,partners,documents,settings,admin,dashboard}/
components/partners/partner-option-row.tsx   # round 32 (MỚI, chưa merge main)
supabase/migrations/202610*.sql       # TẤT CẢ đã áp lên production (qua scripts/apply-round*.mjs + exec_sql)
scripts/apply-round*.mjs              # ops scripts áp migration (pattern idempotent)
scripts/check-partner-count.ts        # round 32: probe số đối tác E2E còn lại (KEEP — CI/người khác cần dùng)
tests/{unit,integration,e2e}/
```

## 6. TÍNH NĂNG ĐÃ CÓ (tóm tắt các round)

- **Wave 1 (M1–M8)**: auth, tổ chức, hợp đồng CRUD + upload R2, dashboard, settings.
- **R2**: danh bạ đối tác. **R3**: nhật ký admin (`/admin/logs`) + export. **R4**: quản lý user (tạo/vai trò/bật-tắt/xoá + tombstone). **R5**: hardening RLS + migration tombstone.
- **R6**: combobox tìm nhanh đối tác (RPC `search_partners`, limit 50, khớp tên/MST/viết tắt).
- **R7**: import đối tác Excel (exceljs, ≤500 dòng/5MB, 2 bước xem trước → nhập).
- **R8–R9**: audit 13 action nghiệp vụ + cột người thực hiện (tên) + câu mô tả tiếng Việt ("… đã thêm hợp đồng X với đối tác Y").
- **R10**: trạng thái hợp tác (active/stopped, badge xanh/xám) + 2 công ty HRP/HR VN (junction nhiều–nhiều).
- **R11**: logo HRP sidebar (`public/hrp-logo.webp`, trong suốt). **R12–R14**: màu chủ đạo/nền/sidebar (popover 🎨 sidebar, lưu `profiles.accent_color/background_color/sidebar_color`, cơ chế `data-*` + CSS, không flash).
- **R15**: dashboard hiện tên đối tác liên kết + badge công ty, bỏ "—".
- **R16**: khu upload **Phụ lục hợp đồng** (chỉ PDF, `contract_files.kind`) + bỏ trường Ghi chú (ẩn khi trống ở chi tiết).
- **R17**: UI refresh Stripe/Linear — nền slate, card `rounded-xl shadow-sm`, bảng hiện đại, metric cards pastel, badge pill, menu active theo accent.
- **R18**: cột Công ty trong danh sách hợp đồng.
- **R19**: **xoá hợp đồng/đối tác + bỏ lưu trữ + tab "Đã lưu trữ"** — chỉ admin đặc quyền (email trong `DELETE_ADMIN_EMAILS`, production mặc định = owner). Xoá hợp đồng xoá R2 trước (fail → huỷ toàn bộ); xoá đối tác bị chặn khi còn hợp đồng.
- **R20**: tab Hợp đồng 3 loại (Đang hoạt động / Đã hết hạn / Đã lưu trữ) + tab Đối tác (Tất cả / Đang / Đã dừng hợp tác). Hợp đồng không có ngày hết hạn = "chưa hết hạn" (nằm tab hoạt động).
- **R21**: trường **Khu vực** + **Tên viết tắt** cho đối tác (tìm kiếm khớp viết tắt; import có 2 cột).
- **R22**: import đọc cột **Trạng thái hợp tác** (bỏ trống → mặc định Đang hợp tác; giá trị lạ → lỗi dòng).
- **R23**: **Xuất Excel đối tác** (3 scope: tất cả / đang / đã dừng) + fix nghẽn fetch companies theo từng dòng (chỉ fetch khi mở sheet).
- **R24**: **xoá hàng loạt** (checkbox + nút "Xoá đã chọn (N)", xử lý từng thực thể độc lập, per-item lỗi, cap 100).
- **R25**: import **chống trùng 5 khoá** theo thứ tự ưu tiên **MST → Tên viết tắt → Tên đối tác → Địa chỉ → Khu vực** → ghi đè (điền-thiếu + union công ty) **TRỪ khi khác công ty (không giao) → tạo mới**. Preview hiện "Thêm mới / Cập nhật \<tên\> / Lỗi". Chỉ áp dụng cho IMPORT — form tay giữ nguyên (xem R29).
- **R26**: cột "Tên viết tắt" tách riêng trong bảng Đối tác.
- **R27**: fix lỗi "không lưu được" — nếu tải danh sách công ty fail, form giờ **hiện Alert + nút Thử lại** (trước đây im lặng khoá nút Lưu). Đường lưu status đã xác minh chạy đúng + có e2e chống tái diễn.
- **R28**: bộ lọc **Số hợp đồng** (Tất cả / Có / Chưa có) kết hợp tab trạng thái (`?contracts=`).
- **R29**: form tay **check trùng MST theo công ty** (tách khỏi round 25 chỉ áp dụng import). MST trùng nhưng **khác công ty** → cho phép tạo/sửa. Cùng công ty → lỗi như cũ. Có integration + e2e (xem `tests/integration/partner-tax-code-company.test.ts` + bổ sung trong `tests/e2e/partners.spec.ts`).
- **R30**: **bộ lọc trực tiếp trong header cột** Đối tác (Tên/Tên viết tắt/Khu vực = ô nhập khớp chứa bỏ dấu; Công ty = dropdown derive từ dữ liệu) — client-side, AND nhau, kết hợp filter server; **xoá cột "Cập nhật lúc"**.
- **R31**: **responsive bảng Đối tác** — ẩn bớt cột trên màn hình hẹp (đi với R29 trong commit `a0e2cda`).
- **R32** (trên branch `feat/partner-combobox-companies`, **CHƯA merge main**): combobox chọn đối tác ở form thêm hợp đồng hiện **badge công ty liên kết** (HRP / HR VN / cả hai) ở cả **dòng lựa chọn** lẫn **nút đã chọn**.
  - Lazy theo từng đối tác (không nạp toàn bộ lúc đầu — payload vẫn nhẹ như R6).
  - Tái dùng `CompanyBadges` (REUSE FIRST), không viết badge mới.
  - Refactor: tách `components/partners/partner-option-row.tsx` (MỚI) để per-row loading + cancel khi unmount.
  - Service mới: `companiesForOnePartner(partnerId, { organizationId })` — đổi tên từ `companiesForPartner` (private), giữ `companiesForPartners` (bulk) không đổi.
  - Server action mới: `partnerCompaniesAction(id)`.
  - Backward-compat: `PartnerOption.companies?: string[]` optional.
  - Có 1 case e2e trong `tests/e2e/partners.spec.ts` mở form `/contracts/new` → mở combobox → expect `data-testid="partner-company-badge"`.
  - **Lệch so với prompt gốc**: T2 tách component con + đổi deps effect `[selected, companiesByPartner]` thay vì `[open, term, options, selected]` + `inflightRef`. T1 đã duyệt (lý do: per-row loading state rõ ràng hơn, cancel an toàn khi user gõ nhanh). Ghi nhận để không "sửa" về spec cũ.
  - **Script mới**: `scripts/check-partner-count.ts` (commit `2b35d53`) — probe số đối tác E2E còn lại trong Supabase. KEEP, CI/người khác cần dùng.

Các round nhỏ khác: favicon `app/favicon.ico` (file của owner), logo sidebar trong suốt.

## 7. GATE (phải xanh trước khi push)

```
pnpm build · typecheck · lint (0 warning) · unit · FULL integration · FULL e2e (mọi spec)
```

Số liệu chuẩn gần nhất:
- `main` (round 31): unit 272/272 · integration 152/152 + 1 skip · e2e 98/98 + 3 skip · build PASS.
- `feat/partner-combobox-companies` (round 32, báo cáo T2): R32 spec pass, full e2e "5/5 pass" — **T2 chưa paste log chi tiết từng spec**; Owner cần tự verify trên máy Owner trước khi merge (xem §9 bước 2).

Dọn dẹp sau mỗi lần chạy:
- Probe tự xoá (`app/api` chỉ còn `admin`/`files`/`partners`)
- Junction `partner_companies` = 143 row thật (giữ)
- Audit test rows dọn về 0 (giữ nhật ký thật)
- Theme `e2e.wave2` về null
- Port 3000/3100 trống
- Đối tác E2ETEST/W1TEST trong `partners` bảng = 0 (verify bằng `scripts/check-partner-count.ts` — trên branch round 32; `main` chưa có script này)

## 8. QUY TRÌNH LÀM VIỆC (user ↔ T1 ↔ AI coding)

- **Owner** = chủ dự án, giao yêu cầu bằng tiếng Việt. Mỗi round chia thành **task nhỏ**; mỗi task = 1 prompt rõ ràng (Owner chốt sẵn: phạm vi, hành vi, label, testid…).
- **T1** = coordinator/reviewer (agent hiện tại). Chốt prompt, review báo cáo T2, ra quyết định kỹ thuật (reword/merge/squash). KHÔNG tự code thay T2.
- **T2** (và sub-agent) = coder. Nhận prompt từ T1, code, báo cáo 5 mục, **KHÔNG push** — T1/Owner push sau khi chốt.
- Không tự ý đổi quyết định Owner; phát hiện bug/hồi quy → báo kèm bằng chứng, không sửa im lặng; không đụng dữ liệu thật (test chỉ dùng prefix `E2ETEST-`/`W1TEST-` + email throwaway `w1test.*@hrpartner.test`).

## 9. VIỆC CẦN LÀM NGAY KHI TIẾP QUẢN

> Thứ tự ưu tiên. Mỗi bước = 1 task. Hoàn thành bước trước rồi mới sang bước sau.

### TASK 0 — Verify state hiện tại (5 phút)

```powershell
cd D:\HRP-app\Contract-mange-hrp
git fetch origin
git branch -vv
git log --oneline -10
git log origin/main --oneline -10
git log origin/feat/partner-combobox-companies --oneline -10
```

Kỳ vọng:
- `main` = `a0e2cda` (round 29+31)
- `feat/partner-combobox-companies` = `2b35d53` (round 32 + script verify)
- 2 commit `f0636a8` + `8644a95` đều tên `checkpoint before checking out main` (tiếng Anh — sẽ sửa ở task 1)

### TASK 1 — Reword 2 commit checkpoint (chưa merge, reword an toàn)

```powershell
cd D:\HRP-app\Contract-mange-hrp
git checkout feat/partner-combobox-companies
git rebase -i a0e2cda
# Trong editor: đổi 2 dòng `pick` thành `reword`
# Lưu + thoát. Git mở tiếp editor cho từng commit.
```

| Commit (cũ → gần) | Message mới (tiếng Việt) |
|---|---|
| `8644a95` (gần) | `feat(partners): checkpoint round 32 — refactor combobox + tách PartnerOptionRow` |
| `f0636a8` (xa) | `feat(partners): checkpoint round 32 — gộp 5 file revert + 2 file mới` |

Sau khi reword:

```powershell
git log --oneline -5
# Kỳ vọng: 2b35d53 → 8644a95 (reworded) → f0636a8 (reworded) → a0e2cda
git status
# Kỳ vọng: có thể báo "branch is ahead of origin" — OK, chưa push
```

**Nếu lỗi** (conflict, hoặc commit đã có nội dung khác): dừng, paste lỗi cho T1.

### TASK 2 — Verify full gate trên branch `feat/partner-combobox-companies`

> T2 báo "5/5 pass" nhưng T2 chưa paste log chi tiết từng spec. Owner/T1 cần tự xác minh.

```powershell
cd D:\HRP-app\Contract-mange-hrp
pnpm typecheck
pnpm lint
pnpm build
pnpm test --run          # unit
pnpm test:integration    # integration
pnpm test:e2e            # e2e (mất ~16 phút)
pnpm exec tsx scripts/check-partner-count.ts
# Kỳ vọng: "E2E partners còn lại: 0"
```

Nếu fail → sửa trước khi merge. Nếu pass → tiếp task 3.

### TASK 3 — Merge `--no-ff` vào main + push

```powershell
cd D:\HRP-app\Contract-mange-hrp
git checkout main
git status
# Kỳ vọng: On branch main, nothing to commit, working tree clean

git merge --no-ff feat/partner-combobox-companies -m "merge: round 32 — combobox hien cong ty lien ket"

git log --oneline -8
# Kỳ vọng: merge commit → 2b35d53 → 8644a95 (reworded) → f0636a8 (reworded) → a0e2cda

git push origin main
```

**Nếu bị từ chối TLS schannel** (sandbox): chạy từ Git Bash/MinGit ngoài sandbox, hoặc `git config --global http.sslBackend openssl` rồi push lại.

Sau push:

```powershell
git log origin/main --oneline -8
# Kỳ vọng: giống local
```

### TASK 4 — Verify post-merge

```powershell
cd D:\HRP-app\Contract-mange-hrp
git checkout main
git pull --ff-only
pnpm typecheck
pnpm lint
pnpm build
git log origin/main --oneline -5
# Kỳ vọng: HEAD = merge commit mới, tất cả commit checkpoint đã reword tiếng Việt
```

### TASK 5 — Viết handover tiếp theo (nếu cần)

Sau khi round 32 merged, cập nhật handover này thành snapshot mới, hoặc tạo `docs/handovers/HANDOVER-NEXT-AI-<date>.md` mới. Giữ handover cũ làm tham chiếu.

## 10. LƯU Ý KỸ THUẬT KHÁC (gotchas đã đúc kết)

- `updatePartner`/`updateContract` = partial (chỉ ghi key caller gửi — đừng biến thành full-row update).
- Import Excel: `parsePartnerWorkbook` nhận `ArrayBuffer | Uint8Array`; MIME gate có fallback đuôi `.xlsx` (Windows gửi octet-stream).
- `search_partners` RPC: `security invoker`, fold `unaccent` + `đ→d`, chỉ trả `status='active'`, LIMIT 50.
- Audit: `recordAudit` (service-role, swallow lỗi — không bao giờ chặn nghiệp vụ); `recordCurrentUserAudit` lấy actor từ session. Cột `audit_logs.actor_id` FK RESTRICT → khi xoá user phải purge audit rows trước (pattern `purgeAuditRowsForUser`).
- Delete entity: session client KHÔNG có quyền DELETE (hardening) → service-role; xoá hợp đồng = R2 objects → contract_files rows → contract (fail R2 = huỷ toàn bộ).
- Theme: `--background` mặc định light = `210 40% 98%` (slate-50); preset nền "gray/blue" gần giống default là chủ ý (giữ 6 preset). Menu active dùng `bg-primary/10 text-primary` (theo accent user).
- Git: MinGit tại `D:\HRP-app\tools\mingit\cmd\git.exe` (không nằm trong PATH); push cần full-access (TLS schannel bị sandbox chặn) — do T1/owner push, AI coding KHÔNG push.
- Sandbox T1: `pnpm`/vitest/playwright cần escalation (EPERM); đọc file UTF-8 dùng `[System.IO.File]::ReadAllText` (Get-Content đọc CP1252 gây mojibake).
- **Round 32 cụ thể**:
  - `PartnerOptionRow` cancel khi unmount: dùng flag `cancelled` (set true trong cleanup) — KHÔNG dùng `AbortController`. Request vẫn chạy đến server, chỉ không setState. Có thể có memory leak nhẹ nếu user gõ rất nhanh — đã chấp nhận ở review T1.
  - Effect deps ở `partner-combobox.tsx` = `[selected, companiesByPartner]` (KHÔNG phải `[open, term, options, selected]` như spec gốc) — đã duyệt.
  - `companiesForOnePartner` thêm guard tường minh `organization_id` trên `partners` (trả `[]` thay vì lộ sự tồn tại) — RLS `partner_companies` đã chặn nhưng check thêm để chắc.

## 11. Ý TƯỞNG TƯƠNG LAI (owner từng nhắc, chưa làm)

- Pagination cho Đối tác → khi có thì chuyển bộ lọc client (R30) xuống server.
- Export CSV (hiện chỉ txt/xlsx) nếu owner yêu cầu.
- Cảnh báo thực tế khoá "Khu vực" trong chống trùng import (khoá yếu nhất — nếu gộp nhầm đối tác cùng miền thì bỏ khoá).
- Audit cho hành động export đối tác (hiện chưa ghi).

## 12. CHÚ THÍCH VỀ BẢN HANDOVER NÀY

- **HEAD tham chiếu**: `a0e2cda` (main, round 29+31) + `2b35d53` (branch round 32, chưa merge).
- **Lần sửa cuối**: 2026-10-10.
- **Sự khác biệt so với handover cũ** (`HANDOVER-NEXT-AI.md`):
  1. Cập nhật số liệu test: `main` có thêm round 31 (responsive).
  2. Thêm round 29 (check trùng MST theo công ty) vào §6.
  3. Thêm round 32 (combobox công ty) vào §6 với ghi chú "CHƯA merge main".
  4. §9 đổi từ "prompt round 29" sang 5 task cụ thể (reword → verify → merge → push → verify post-merge).
  5. §7 thêm script `check-partner-count.ts` (MỚI ở round 32) vào checklist dọn dẹp.
  6. §10 bổ sung gotchas riêng round 32 (`PartnerOptionRow` cancel, effect deps, `companiesForOnePartner` guard).
- **File cũ giữ nguyên** làm tham chiếu lịch sử, KHÔNG xoá.

---

## PHỤ LỤC A — Trạng thái git tại thời điểm viết handover (2026-10-10)

```
$ git branch -vv
* feat/partner-combobox-companies  2b35d53 [origin/feat/partner-combobox-companies] feat: add script to verify remaining E2E partner count in Supabase
  main                             a0e2cda [origin/main] feat(partners): company-scoped tax code check and responsive table columns (round 29+31)

$ git log --oneline -10
2b35d53 feat: add script to verify remaining E2E partner count in Supabase
8644a95 checkpoint before checking out main
f0636a8 checkpoint before checking out main
a0e2cda feat(partners): company-scoped tax code check and responsive table columns (round 29+31)
72cf8f0 docs: complete project handover for the next AI agent
e64bdb3 feat(partners): inline column filters (name/abbr/region/company) and drop updated-at column (round 30)
ddcb7cc feat(partners): contract-count filter (all/has/none) with status combo (round 28)
ba040db fix(partners): surface company-list load failure with retry; e2e for status edit (round 27)
0a72127 feat(partners): separate abbreviation column in the partners list (round 26)
21a43c9 test(e2e): align partner-status assertion with new import summary wording (round 25, task 3)

$ git status
On branch feat/partner-combobox-companies
Your branch is up to date with 'origin/feat/partner-combobox-companies'.
nothing to commit, working tree clean
```

## PHỤ LỤC B — Lệnh nhanh khi tiếp quản

```powershell
# 1. Verify state
cd D:\HRP-app\Contract-mange-hrp
git fetch origin
git log --oneline -5
git log origin/main --oneline -5

# 2. Reword 2 commit checkpoint (xem §9 task 1)
git checkout feat/partner-combobox-companies
git rebase -i a0e2cda

# 3. Verify gate (xem §9 task 2)
pnpm typecheck; pnpm lint; pnpm build
pnpm test --run; pnpm test:integration; pnpm test:e2e
pnpm exec tsx scripts/check-partner-count.ts

# 4. Merge + push (xem §9 task 3)
git checkout main
git merge --no-ff feat/partner-combobox-companies -m "merge: round 32 — combobox hien cong ty lien ket"
git push origin main

# 5. Verify post-merge (xem §9 task 4)
git pull --ff-only
pnpm typecheck; pnpm lint; pnpm build
```

---

Hết. Owner/T1 review trước khi giao AI mới. Khi AI mới nhận handover này, bắt đầu từ §0 → §9.
