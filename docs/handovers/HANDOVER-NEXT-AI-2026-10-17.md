# BÀN GIAO TOÀN BỘ DỰ ÁN — CHO AI MỚI (snapshot 2026-10-17)

> Tài liệu này là **nguồn sự thật duy nhất** để một AI Coding Agent mới tiếp quản dự án.
> Repo: `D:\HRP-app\Contract-mange-hrp` (GitHub: `duongltvp95-lang/contract-manage-hrp`).
> Ngày handover: **2026-10-17** (UTC+7).
> Handover cũ:
> - `docs/handovers/HANDOVER-NEXT-AI-2026-10-10.md` — **giữ nguyên** làm tham chiếu lịch sử round 29+31+32, KHÔNG đè.
> - `docs/handovers/HANDOVER-NEXT-AI.md` (round 30) — giữ làm tham chiếu, đã 1 tháng.
> File này **ưu tiên hơn** nếu có mâu thuẫn.

> **QUAN TRỌNG**: File này **không** chứa mật khẩu / PAT / service_role / R2 secret / `GEMINI_API_KEY`. Mọi thông tin nhạy cảm nằm trong `.env.local` (do Owner giữ, không commit).

---

## 0. TÓM TẮT 30 GIÂY

- **App**: Contract Manager — quản lý hợp đồng + danh bạ đối tác cho HRP / HR VN.
  Production: `https://cm.hrpartner.vn` + `https://contract-manage-hrp.vercel.app`.
- **Stack**: Next.js 16.3.8 App Router (Turbopack) + React 19 + TypeScript strict + pnpm + Supabase (Postgres 17 + Auth + RLS) + Cloudflare R2.
- **AI**: Google Gemini (`extractContractFromBuffer` ở `lib/ai/gemini.ts`) — flow đang dùng `inlineData` base64, **T1 đã đánh giá chậm** và viết kế hoạch G2 (Gemini Files API) tại `docs/plan/g2-gemini-files-api.md`. **G2 sẽ là round 33 chính thức.**
- **Trạng thái main**: `a0e2cda` (round 29 + 31 — đã push).
- **Branch có việc dở**: `cursor/ai-gemini-key-and-extract-test` (4 commit `7dc935a` ← `2dfa0bd` ← `df926b9` ← `ab8ff91`) — chứa kế hoạch G2 + prompt G2 + sửa 1 dòng CI. **CHƯA merge main.** Branch này cũng có commit `ab8ff91` — Owner CHƯA verify có lộ `GEMINI_API_KEY` thật không (xem §10 B8).
- **Đọc rule trước khi code**: `.cursor/rules/agent-working-rules.mdc` (10 điều, đặc biệt §1 tiếng Việt, §2 không lộ credential, §6 dọn dẹp).

---

## 1. DỰ ÁN LÀ GÌ

**Contract Manager (Quản lý hợp đồng)** — app quản lý hợp đồng + danh bạ đối tác cho công ty **HRP / HR VN**.
Production: `https://cm.hrpartner.vn` (chính) và `https://contract-manage-hrp.vercel.app` (Vercel auto-deploy từ `main`).

## 2. STACK

- **Next.js 16.3.8** App Router (Turbopack), React 19, TypeScript strict, pnpm.
- Tailwind + shadcn-style (Radix) UI, lucide-react, sonner (toast), react-hook-form + zod, date-fns, **exceljs** (import/export Excel), `@aws-sdk/client-s3` (R2 presign/upload).
- **Supabase** (Postgres 17 + Auth + RLS), project ref `vohrerrbthbrkwjllnlj`, region ap-northeast-2. Keys dạng `sb_publishable_*` / `sb_secret_*` trong `.env.local`.
- **Cloudflare R2** bucket `hrp-contract` (private, S3-compatible) — lưu file hợp đồng.
- **Google Gemini API** (`@google/generative-ai` KHÔNG dùng, dùng `fetch` trực tiếp) — trích xuất metadata hợp đồng từ PDF/ảnh.
- Test: **Vitest** (unit + integration đánh Supabase/R2 THẬT) + **Playwright** e2e (Chrome thật). CI: GitHub Actions (`quality` job luôn chạy; integration/e2e tự skip khi thiếu secrets).

## 3. QUY ƯỚC BẮT BUỘC (đọc kỹ trước khi code)

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
- Supabase/R2/Gemini **thỉnh thoảng chậm** → integration/e2e timeout là transient: chạy lại tối đa 2 lần trước khi kết luận hồi quy. `partners.spec` từng cần `--testTimeout=180000`.
- **KHÔNG BAO GIỜ**: xoá user `e2e.wave2@hrpartner.vn` (tài khoản test bắt buộc, admin), đụng dữ liệu thật của owner, set `DELETE_ADMIN_EMAILS` trên Vercel, commit `GEMINI_API_KEY` thật.
- **Không tự ý đổi quyết định Owner** — rule §4; phát hiện bug/hồi quy → báo kèm bằng chứng, không tự sửa im lặng. Được phép tự quyết: sửa typo, lint, test, refactor nội bộ không đổi hành vi.
- **Báo cáo 5 mục** sau mỗi task: (1) đã làm + file + commit; (2) kết quả test THẬT; (3) lệch + lý do; (4) commit/push? (**chưa**); (5) rủi ro.

## 4. TÀI KHOẢN / DỮ LIỆU THẬT (tuyệt đối không đụng khi test)

| Đối tượng | Giá trị | Ghi chú |
|---|---|---|
| Owner | `duongltvp95@gmail.com` — profile "DUONG", admin | accent=violet, background=cream, sidebar=cream (do owner tự đổi) |
| User thật đang dùng | `duongamo10300@gmail.com` (admin) | đang hoạt động thường xuyên |
| Tài khoản test | `e2e.wave2@hrpartner.vn` — "E2E Wave 2 Admin", admin | password trong `.env.local` — **không được xoá** |
| Đối tác | **144 đối tác thật** (123 active + 21 stopped) + 144 row junction `partner_companies` | dữ liệu owner, không được sweep |
| Công ty | `companies`: chỉ 2 dòng seed **HRP** + **HR VN** | |
| Hợp đồng | hiện **0** (owner đã tự xoá hết bằng tính năng xoá — hành động chủ động của owner, ghi trong audit) | |
| Tombstone | `tombstone.deleted-user@hrpartner.vn` (profile `is_tombstone=true`) | xoá mềm để giữ FK audit_logs |

## 5. CẤU TRÚC QUAN TRỌNG

```
docs/plan/wave1-plan-v1.1.md          # master plan gốc (Wave 1)
docs/plan/g2-gemini-files-api.md      # KẾ HOẠCH G2 (round 33) — bắt buộc đọc
docs/HANDOVER-T2.md + docs/handovers/AI-AGENT-HANDOVER.md   # handover cũ (còn giá trị tham chiếu)
docs/handovers/HANDOVER-NEXT-AI-2026-10-10.md  # handover round 32
docs/handovers/HANDOVER-NEXT-AI-2026-10-17.md  # HANDOVER HIỆN TẠI (file này)
docs/prompts/round*.md                # prompt giao việc từng round
docs/REVIEW-2026-10-11.md             # T1 review tổng thể (nợ 6 task §6.1)
.cursor/rules/agent-working-rules.mdc # quy tắc làm việc T2
lib/services/{contracts,partners,files,users,audit-logs,dashboard,organizations,profiles}.ts
lib/partner-merge.ts                  # round 25: 5-khoá chống trùng + ghi đè (chỉ import)
lib/partner-import.ts                 # parse Excel (cột: Tên/Địa chỉ/MST/Khu vực/Tên viết tắt/Công ty/Trạng thái)
lib/partner-display.ts                # foldText, partnerDisplayName, PARTNER_SEARCH_LIMIT=50
lib/theme-{accents,backgrounds,sidebars}.ts   # preset màu (6 mỗi loại)
lib/delete-permissions.ts             # canDeleteEntities + BULK_DELETE_LIMIT=100
lib/ai/gemini.ts                      # AI extraction — flow hiện tại (sẽ refactor G2)
lib/ai/matching.ts                    # AI helper: chuẩn hoá tên/ngày/công ty nội bộ
packages/schemas/*.ts                 # zod schemas dùng chung (partner, contract, file, audit-log, theme, profile…)
app/(app)/{dashboard,contracts,partners,admin/logs,settings}
app/api/files/*                       # presign + complete upload (KHÔNG bao gồm AI)
app/api/ai/upload-url/route.ts        # presign R2 cho AI flow (KHÔNG gọi Gemini trực tiếp)
app/api/admin/logs/export/route.ts    # export nhật ký txt/xlsx
app/api/partners/export/route.ts      # round 23: export đối tác 3 scope
components/{contracts,partners,documents,settings,admin,dashboard}/
supabase/migrations/202610*.sql       # 30 migration (đến 2026-10-20)
scripts/apply-round*.mjs              # ops scripts áp migration (pattern idempotent)
scripts/check-partner-count.ts        # round 32: probe số đối tác E2E còn lại (KEEP)
tests/{unit,integration,e2e}/
```

## 6. TÍNH NĂNG ĐÃ CÓ (tóm tắt các round)

- **Wave 1 (M1–M8)**: auth, tổ chức, hợp đồng CRUD + upload R2, dashboard, settings.
- **R2**: danh bạ đối tác. **R3**: nhật ký admin (`/admin/logs`) + export. **R4**: quản lý user (tạo/vai trò/bật-tắt/xoá + tombstone). **R5**: hardening RLS + migration tombstone.
- **R6**: combobox tìm nhanh đối tác (RPC `search_partners`, limit 50, khớp tên/MST/viết tắt).
- **R7**: import đối tác Excel (exceljs, ≤500 dòng/5MB, 2 bước xem trước → nhập).
- **R8–R9**: audit 13 action nghiệp vệ + cột người thực hiện (tên) + câu mô tả tiếng Việt.
- **R10**: trạng thái hợp tác (active/stopped, badge xanh/xám) + 2 công ty HRP/HR VN.
- **R11**: logo HRP sidebar. **R12–R14**: màu chủ đạo/nền/sidebar (preset 6 màu mỗi loại).
- **R15**: dashboard hiện tên đối tác liên kết + badge công ty.
- **R16**: khu upload **Phụ lục hợp đồng** (chỉ PDF, `contract_files.kind`).
- **R17**: UI refresh Stripe/Linear. **R18**: cột Công ty trong danh sách hợp đồng.
- **R19**: xoá hợp đồng/đối tác + bỏ lưu trữ — chỉ admin đặc quyền (R2 → DB transaction).
- **R20**: tab Hợp đồng 3 loại (Đang hoạt động / Đã hết hạn / Đã lưu trữ).
- **R21**: Khu vực + Tên viết tắt. **R22**: import đọc cột Trạng thái hợp tác.
- **R23**: Xuất Excel đối tác (3 scope). **R24**: xoá hàng loạt (cap 100).
- **R25**: import chống trùng 5 khoá (MST → Tên viết tắt → Tên → Địa chỉ → Khu vực).
- **R26**: cột Tên viết tắt. **R27**: surface alert khi load công ty fail.
- **R28**: filter Số hợp đồng. **R29**: check trùng MST theo công ty (form tay).
- **R30**: filter trực tiếp trong header cột Đối tác + bỏ cột "Cập nhật lúc".
- **R31**: responsive bảng Đối tác. **R32**: combobox công ty liên kết (merge `a0e2cda`).
- **AI Extraction** (chưa có round chính thức, đang ở main): Google Gemini trích xuất metadata hợp đồng từ PDF/ảnh, fallback chain 3 model × 12s, presign R2 cho file > 1 MB.
- **Tối ưu DB giai đoạn 1** (20261020000000): partial + composite indexes cho `contracts`, `partners` (xem migration mới nhất).
- **Migration `get_partners_summary(uuid)`** (20261018000000): DB-aggregated contract count + companies (security invoker, thay cho in-memory).
- **Migration `count_contract_files(uuid[])`** (20261019000000): DB-aggregated file count per contract.
- **Cột `contracts.company_id`** (20261017090000): nullable FK → `companies`, bắt buộc khi tạo mới, optional khi sửa.

## 7. GATE (phải xanh trước khi merge/push)

```
pnpm build · typecheck · lint (0 warning) · unit · FULL integration · FULL e2e (mọi spec)
```

Số liệu chuẩn gần nhất:
- `main` (round 32 merged): unit 272/272 · integration 152/152 + 1 skip · e2e 98/98 + 3 skip · build PASS.
- ⚠️ Trên máy Owner bị ACL deny `.next*` — chỉ `pnpm build` (NEXT_DIST_DIR=.next-verify), integration/e2e **chạy trên CI**.

Dọn dẹp sau mỗi lần chạy:
- Probe tự xoá (`app/api` chỉ còn `admin`/`files`/`partners`/`ai`)
- Junction `partner_companies` = 144 row thật (giữ)
- Audit test rows dọn về 0 (giữ nhật ký thật)
- Theme `e2e.wave2` về null
- Port 3000/3100 trống
- Đối tác E2ETEST/W1TEST trong `partners` bảng = 0

## 8. QUY TRÌNH LÀM VIỆC (Owner ↔ T1 ↔ AI coding)

- **Owner** = chủ dự án, giao yêu cầu bằng tiếng Việt. Mỗi round chia thành **task nhỏ**; mỗi task = 1 prompt rõ ràng (Owner chốt sẵn: phạm vi, hành vi, label, testid…).
- **T1** = coordinator/reviewer (agent đánh giá, viết kế hoạch + prompt, review báo cáo T2, ra quyết định kỹ thuật: reword/merge/squash). KHÔNG tự code thay T2.
- **T2** (và sub-agent) = coder. Nhận prompt từ T1, code, báo cáo 5 mục, **KHÔNG push** — T1/Owner push sau khi chốt.
- Không tự ý đổi quyết định Owner; phát hiện bug/hồi quy → báo kèm bằng chứng, không tự sửa im lặng; không đụng dữ liệu thật (test chỉ dùng prefix `E2ETEST-`/`W1TEST-` + email throwaway `w1test.*@hrpartner.test`).

## 9. VIỆC CẦN LÀM NGAY KHI TIẾP QUẢN

### TASK 0 — Đọc 4 file bắt buộc (30 phút, đọc xong mới code)

```powershell
cd D:\HRP-app\Contract-mange-hrp
```

- [ ] `docs/handovers/HANDOVER-NEXT-AI-2026-10-17.md` (file này)
- [ ] `docs/REVIEW-2026-10-11.md` (T1 review tổng thể)
- [ ] `.cursor/rules/agent-working-rules.mdc` (10 điều bắt buộc)
- [ ] `docs/plan/g2-gemini-files-api.md` (kế hoạch round 33)

### TASK 1 — Verify state hiện tại (5 phút)

```powershell
cd D:\HRP-app\Contract-mange-hrp
git fetch origin
git branch -vv
git log --oneline -10
git log origin/main --oneline -10
```

**Kỳ vọng**:
- `main` = `a0e2cda` (round 32 đã merge).
- `cursor/ai-gemini-key-and-extract-test` = `7dc935a` (4 commit chưa merge main) — **CÓ CHỨA kế hoạch G2 + prompt G2 + sửa 1 dòng CI**.

### TASK 2 — Verify B8 (BẮT BUỘC trước khi xử lý branch AI) — 5 phút

```powershell
git show ab8ff91 -- '*.ts' '*.tsx' '*.sql' '*.mjs' '*.env*' | Select-String -Pattern 'AIzaSy|GEMINI_API_KEY.*=.*[\x27\x22]'
```

- **Nếu có output** → `GEMINI_API_KEY` thật bị commit. **Báo T1/Owner ngay** để rotate key trên Google AI Studio + revert commit.
- **Nếu không có output** → OK, có thể tiếp tục.

### TASK 3 — Nhận round 33 (G2 — refactor AI sang Gemini Files API)

Đọc 3 file theo thứ tự:

1. `docs/plan/g2-gemini-files-api.md` (kế hoạch T1 đã viết, 9 mục)
2. `docs/prompts/round33-g2-gemini-files-api.md` (prompt T1 đã giao)
3. `lib/ai/gemini.ts` (code hiện tại, 293 dòng)

Code theo checklist ở kế hoạch §7 + 10 (B9 logging).

**Tạo branch mới**: `feat/ai-gemini-files-api` (KHÔNG dùng branch `cursor/ai-gemini-key-and-extract-test` — đó là branch T1, có 4 commit chưa verify).

**Verify môi trường** (in SET/EMPTY/độ dài — KHÔNG in giá trị):
- `GEMINI_API_KEY` SET, ~39 ký tự (chuẩn `AIzaSy...`)? → **Báo T1 nếu EMPTY**.
- `NEXT_PUBLIC_SUPABASE_URL` SET?
- `SUPABASE_SERVICE_ROLE_KEY` SET?
- `R2_*` (6 biến) SET?

**Gate cuối**:
```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm test --run          # bao gồm 5 test mới cho Files API + 2 test cho aiLog
pnpm test:integration    # nếu GEMINI_API_KEY SET → chạy; EMPTY → skip
pnpm test:e2e            # bao gồm e2e extract hiện có
```

→ Báo cáo 5 mục. **KHÔNG push** đợi T1/Owner duyệt.

## 10. ĐIỂM NỢ KỸ THUẬT CÒN SÓT (T1 phát hiện 2026-10-17)

Ngoài 6 task đã done trong review 11/10 (`docs/REVIEW-2026-10-11.md` §6.1), còn **9 điểm**:

| # | Mức độ | Điểm nợ | Đã xử lý? |
|---|---|---|---|
| B1 | Thấp | `gemini-3-flash-preview` — model mới, có thể 404 khi Owner test | Đã có fallback; chờ verify thực tế |
| B2 | Trung bình | System prompt inline ~1 KB, không versioning/A-B test | Sẽ giải quyết khi G2 (refactor) |
| B3 | Thấp | Log Gemini không in `time-to-first-token`/duration từng model | Sẽ giải quyết khi G2 (refactor + B9) |
| B4 | Thấp | `ai-temp/` chỉ dọn bằng lifecycle 24h (R2) | OK — chấp nhận |
| B5 | Thấp | `.github/workflows/ci.yml` 1 dòng chưa commit | ✅ ĐÃ COMMIT (commit `df926b9`, branch `cursor/ai-gemini-key-and-extract-test`) |
| B6 | Trung bình | `HANDOVER-T2.md` lỗi thời (vẫn nói "round 3 đang dở") | Owner tự cập nhật |
| B7 | Thấp | `package.json` chưa enforce `packageManager: pnpm@10` | Chưa xử lý |
| **B8** | **CAO** | Branch `cursor/ai-gemini-key-and-extract-test` có commit `ab8ff91` cần verify không lộ secret | **CHỜ Owner verify** (xem TASK 2) |
| **B9** | Thấp | 4 chỗ `console.log/warn` thẳng trong `lib/ai/gemini.ts:170/226/257/281` | ✅ ĐÃ GỘP VÀO G2 (xem mục 10 kế hoạch G2) |

## 11. LƯU Ý KỸ THUẬT KHÁC (gotchas đã đúc kết)

- `updatePartner`/`updateContract` = partial (chỉ ghi key caller gửi — đừng biến thành full-row update).
- Import Excel: `parsePartnerWorkbook` nhận `ArrayBuffer | Uint8Array`; MIME gate có fallback đuôi `.xlsx` (Windows gửi octet-stream).
- `search_partners` RPC: `security invoker`, fold `unaccent` + `đ→d`, chỉ trả `status='active'`, LIMIT 50.
- Audit: `recordAudit` (service-role, swallow lỗi — không bao giờ chặn nghiệp vụ); `recordCurrentUserAudit` lấy actor từ session. Cột `audit_logs.actor_id` FK RESTRICT → khi xoá user phải purge audit rows trước (pattern `purgeAuditRowsForUser`).
- Delete entity: session client KHÔNG có quyền DELETE (hardening) → service-role; xoá hợp đồng = R2 objects → contract_files rows → contract (fail R2 = huỷ toàn bộ).
- Theme: `--background` mặc định light = `210 40% 98%` (slate-50); preset nền "gray/blue" gần giống default là chủ ý (giữ 6 preset). Menu active dùng `bg-primary/10 text-primary` (theo accent user).
- Git: MinGit tại `D:\HRP-app\tools\mingit\cmd\git.exe` (không nằm trong PATH); push cần full-access (TLS schannel bị sandbox chặn) — do T1/owner push, AI coding KHÔNG push.
- Sandbox T1: `pnpm`/vitest/playwright cần escalation (EPERM); đọc file UTF-8 dùng `[System.IO.File]::ReadAllText` (Get-Content đọc CP1252 gây mojibake).
- **AI flow (chưa refactor)**:
  - `extractContractFromBuffer({ buffer, mimeType, filename })` — hiện dùng `inlineData` base64 + fallback chain 3 model × 12s.
  - Presign R2 cho file > 1 MB ở `app/api/ai/upload-url/route.ts`.
  - 4 chỗ `console.log/warn` ở `gemini.ts` sẽ bị thay bằng `aiLog` trong G2.
- **Round 32 cụ thể**:
  - `PartnerOptionRow` cancel khi unmount: dùng flag `cancelled` (set true trong cleanup) — KHÔNG dùng `AbortController`. Có thể có memory leak nhẹ nếu user gõ rất nhanh — đã chấp nhận ở review T1.
  - Effect deps ở `partner-combobox.tsx` = `[selected, companiesByPartner]` (KHÔNG phải `[open, term, options, selected]` như spec gốc) — đã duyệt.
  - `companiesForOnePartner` thêm guard tường minh `organization_id` trên `partners` (trả `[]` thay vì lộ sự tồn tại).

## 12. Ý TƯỞNG TƯƠNG LAI (owner từng nhắc, chưa làm)

- Pagination cho Đối tác → khi có thì chuyển bộ lọc client (R30) xuống server.
- Export CSV (hiện chỉ txt/xlsx) nếu owner yêu cầu.
- Cảnh báo thực tế khoá "Khu vực" trong chống trùng import (khoá yếu nhất).
- Audit cho hành động export đối tác (hiện chưa ghi).
- Implement G2 (refactor AI sang Gemini Files API) → round 33.
- Implement B7 (`packageManager: pnpm@10`) → round nhỏ.
- Implement B8 verify (nếu secret lộ → rotate key + revert).

## 13. SỰ KHÁC BIỆT SO VỚI HANDOVER CŨ

| Mục | Cũ (2026-10-10) | Mới (2026-10-17) |
|---|---|---|
| Branch main | `a0e2cda` (chưa có round 32) | `a0e2cda` (đã merge round 32) |
| Số đối tác | 143 | **144** (123 active + 21 stopped) |
| Round mới | R31 + R32 sắp merge | Round 32 đã merge; **Round 33 (G2) đang chuẩn bị** |
| Branch phụ | `feat/partner-combobox-companies` (R32) | `cursor/ai-gemini-key-and-extract-test` (T1 prep G2) |
| File kế hoạch | (không có) | `docs/plan/g2-gemini-files-api.md` — MỚI |
| File prompt | (không có) | `docs/prompts/round33-g2-gemini-files-api.md` — MỚI |
| §10 nợ kỹ thuật | (không có) | B1–B9 — MỚI |
| Số migration | 29 | **30** (đến 2026-10-20) |
| CSP headers | (chưa) | (đã thêm — round 34 trong commit `faa3492`) |
| Auto-deploy guard | (chưa) | (đã thêm — commit `04b3aaf`) |

---

## PHỤ LỤC A — Trạng thái git tại thời điểm viết handover (2026-10-17)

```
$ git branch -vv
* cursor/ai-gemini-key-and-extract-test   7dc935a  kế hoạch G2 + sửa CI + prompt G2
  main                                    a0e2cda [origin/main] round 29+31+32 merged

$ git log cursor/ai-gemini-key-and-extract-test --oneline -5
7dc935a  docs(plan + prompts): gộp B9 (logging có cấu trúc) vào G2
2dfa0bd  docs(prompts): round 33 / G2 - prompt giao AI coder
df926b9  fix(ci): deploy-guard skip khi workflow bị cancel; docs(plan): kế hoạch G2
ab8ff91  feat(ai): bổ sung GEMINI_API_KEY, an toàn khi thiếu, test tách trường   ← CẦN OWNER VERIFY B8
861c2c7  fix(ci): remove invalid maxDuration export from use-server actions file

$ git log origin/main --oneline -5
a0e2cda  feat(partners): company-scoped tax code check and responsive table columns (round 29+31+32)
72cf8f0  docs: complete project handover for the next AI agent
e64bdb3  feat(partners): inline column filters (name/abbr/region/company) and drop updated-at column (round 30)
ddcb7cc  feat(partners): contract-count filter (all/has/none) with status combo (round 28)
ba040db  fix(partners): surface company-list load failure with retry; e2e for status edit (round 27)
```

## PHỤ LỤC B — Lệnh nhanh khi tiếp quản (round 33)

```powershell
# 1. Verify state
cd D:\HRP-app\Contract-mange-hrp
git fetch origin
git log --oneline -5
git log origin/main --oneline -5

# 2. Verify B8 (BẮT BUỘC)
git show ab8ff91 -- '*.ts' '*.tsx' '*.sql' '*.mjs' '*.env*' | Select-String -Pattern 'AIzaSy|GEMINI_API_KEY'

# 3. Tạo branch mới cho round 33 (KHÔNG dùng branch T1)
git checkout main
git pull --ff-only
git checkout -b feat/ai-gemini-files-api

# 4. Đọc 4 file bắt buộc
# - docs/handovers/HANDOVER-NEXT-AI-2026-10-17.md (file này)
# - docs/REVIEW-2026-10-11.md
# - docs/plan/g2-gemini-files-api.md (kế hoạch T1)
# - .cursor/rules/agent-working-rules.mdc (10 điều)

# 5. Verify gate
pnpm typecheck; pnpm lint; pnpm build
pnpm test --run; pnpm test:integration; pnpm test:e2e

# 6. Commit + push branch (KHÔNG merge vào main)
git add -A
git commit -m "feat(ai): refactor sang Gemini Files API để giảm latency"
git push origin feat/ai-gemini-files-api

# 7. Báo cáo 5 mục (đợi T1/Owner duyệt)
```

---

Hết. Owner/T1 review trước khi giao AI mới. Khi AI mới nhận handover này, bắt đầu từ §0 → §10.
