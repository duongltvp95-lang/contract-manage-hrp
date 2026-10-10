# BÀN GIAO TOÀN BỘ DỰ ÁN — CHO AI MỚI

> Tài liệu này là nguồn sự thật duy nhất để một AI Coding Agent mới tiếp quản dự án.
> Repo: `D:\HRP-app\Contract-mange-hrp` (GitHub: `duongltvp95-lang/contract-manage-hrp`, branch `main`).
> HEAD hiện tại: **e64bdb3** (round 30) — đã push, `origin/main` đồng bộ, tree sạch.

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

- **REUSE FIRST** — tái dùng pattern/service có sẵn, không copy logic.
- **Tiếng Việt** trong UI, audit, báo cáo, docs; commit message tiếng Anh conventional-commits.
- **Không rò rỉ credential** (báo cáo chỉ nêu tên biến + trạng thái SET/EMPTY/độ dài).
- **RLS org isolation**: mọi truy vấn theo `organization_id = current_organization_id()`.
- **Không có DELETE client-side** cho contracts/partners/files — chỉ service-role (hardening). Ngoại lệ: admin đặc quyền qua service (xem §9).
- Hợp đồng lưu trữ bị RLS "đóng băng" (`using(... and archived_at is null)`) → **unarchive phải dùng service-role**.
- `exec_sql(text)` (service-role, `returns void`): **1 statement/call**, chỉ cho ops DDL; hàm `returns void` KHÔNG trả được SELECT qua `rpc`.
- RPC mới cần `NOTIFY pgrst, 'reload schema';` sau khi tạo.
- `node_modules` layout **hoisted** (`.npmrc: node-linker=hoisted`) — KHÔNG chuyển sang isolated (đã từng làm hỏng build/pdfjs).
- Root layout có `export const instant = false` (theme server-driven: `data-accent`/`data-background`/`data-sidebar`) → route dynamic, không có PPR static shell — chấp nhận, đừng "sửa".
- Supabase/R2 **thỉnh thoảng chậm** → integration/e2e timeout là transient: chạy lại tối đa 2 lần trước khi kết luận hồi quy. `partners.spec` từng cần `--testTimeout=180000`.
- **KHÔNG BAO GIỜ**: xoá user `e2e.wave2@hrpartner.vn` (tài khoản test bắt buộc, admin), đụng dữ liệu thật của owner, set `DELETE_ADMIN_EMAILS` trên Vercel.

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
supabase/migrations/202610*.sql       # TẤT CẢ đã áp lên production (qua scripts/apply-round*.mjs + exec_sql)
scripts/apply-round*.mjs              # ops scripts áp migration (pattern idempotent)
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
- **R25**: import **chống trùng 5 khoá** theo thứ tự ưu tiên **MST → Tên viết tắt → Tên đối tác → Địa chỉ → Khu vực** → ghi đè (điền-thiếu + union công ty) **TRỪ khi khác công ty (không giao) → tạo mới**. Preview hiện "Thêm mới / Cập nhật \<tên\> / Lỗi". Chỉ áp dụng cho IMPORT — form tay giữ nguyên (xem R29 pending).
- **R26**: cột "Tên viết tắt" tách riêng trong bảng Đối tác.
- **R27**: fix lỗi "không lưu được" — nếu tải danh sách công ty fail, form giờ **hiện Alert + nút Thử lại** (trước đây im lặng khoá nút Lưu). Đường lưu status đã xác minh chạy đúng + có e2e chống tái diễn.
- **R28**: bộ lọc **Số hợp đồng** (Tất cả / Có / Chưa có) kết hợp tab trạng thái (`?contracts=`).
- **R30**: **bộ lọc trực tiếp trong header cột** Đối tác (Tên/Tên viết tắt/Khu vực = ô nhập khớp chứa bỏ dấu; Công ty = dropdown derive từ dữ liệu) — client-side, AND nhau, kết hợp filter server; **xoá cột "Cập nhật lúc"**.
- Các round nhỏ khác: favicon `app/favicon.ico` (file của owner), logo sidebar trong suốt.

## 7. GATE (phải xanh trước khi push)

```
pnpm build · typecheck · lint (0 warning) · unit · FULL integration · FULL e2e (mọi spec)
```
Số liệu chuẩn gần nhất: unit **272/272** · integration **152/152 + 1 skip** · e2e **98/98 + 3 skip** · build PASS.
Dọn dẹp sau mỗi lần chạy: probe tự xoá (`app/api` chỉ còn `admin`/`files`/`partners`) · junction = 143 row thật (giữ) · audit test rows dọn về 0 (giữ nhật ký thật) · theme e2e.wave2 về null · port 3000/3100 trống.

## 8. QUY TRÌNH LÀM VIỆC (user ↔ T1 ↔ AI coding)

- User = owner dự án, giao yêu cầu bằng tiếng Việt. Mỗi round chia thành **task nhỏ**; mỗi task = 1 prompt rõ ràng (quyết định Owner chốt sẵn: phạm vi, hành vi, label, testid…).
- AI code **sau mỗi task báo cáo 5 mục**: (1) đã làm + file; (2) kết quả test THẬT (số liệu); (3) lệch + lý do; (4) commit? (**chưa — không tự commit/push**); (5) rủi ro/việc còn lại.
- **Sau mỗi task review 1 lần** → chốt → mới giao task tiếp. Commit/push do T1/owner thực hiện sau khi chốt.
- Không tự ý đổi quyết định Owner; phát hiện bug/hồi quy → báo kèm bằng chứng, không sửa im lặng; không đụng dữ liệu thật (test chỉ dùng prefix `E2ETEST-`/`W1TEST-` + email throwaway `w1test.*@hrpartner.test`).

## 9. VIỆC ĐANG TREO (LÀM NGAY SAU KHI TIẾP QUẢN)

### ROUND 29 — SỬA LỖI: form đối tác báo trùng MST khi KHÁC công ty (user đã báo lỗi, prompt đã duyệt — chưa chạy)

Prompt đầy đủ đã chốt (copy nguyên văn để giao):

```
Bạn là AI Coding Agent (T2). Round 29 (1 task): Sửa check trùng MST ở form đối
tác — khác công ty thì cho thêm + rà các trường khác + full gate.
HEAD hiện tại: e64bdb3, tree sạch.

ĐỌC TRƯỚC: .cursor/rules/agent-working-rules.mdc · lib/services/partners.ts
(createPartner + updatePartner đang dùng findPartnerByTaxCode chặn CỨNG mọi MST
trùng; findPartnersByTaxCodes + companiesForPartner có sẵn) · lib/partner-merge.ts
(logic so công ty overlap — tái dùng tinh thần).

YÊU CẦU:
1) SỬA CHECK MST THEO CÔNG TY (cả createPartner lẫn updatePartner):
   - Khi MST đến trùng với partner khác: lấy companies của partner đó
     (companiesForPartner) → so GIAO với công ty đang gửi (companyIds → tên
     company qua listCompanies):
     · Giao ≠ rỗng → lỗi như cũ: "Mã số thuế đã được dùng cho đối tác khác
       trong tổ chức" (+ tên partner).
     · Giao = rỗng (khác công ty hoàn toàn) → CHO PHÉP tạo/sửa.
     · Form không gửi companyIds (update không đổi công ty) → giữ hành vi cũ
       (chặn trùng MST).
   - KHÔNG đổi hành vi import (round 25) và KHÔNG tự ghi đè ở form tay.
2) RÀ CÁC TRƯỜNG KHÁC: kiểm tra createPartner/updatePartner còn chỗ nào chặn
   trùng/độc nhất khác không (name/abbreviation/address/region) — báo cáo rõ
   từng trường: có check không, có cần sửa không (dự kiến: không có check nào
   khác → chỉ MST có lỗi này).
3) TESTS:
   - Integration (mở rộng partner-status-companies hoặc file mới): tạo partner
     MST X công ty HRP → tạo tiếp MST X công ty HR VN → THÀNH CÔNG (2 dòng) ·
     tạo MST X công ty HRP lần nữa → LỖI · updatePartner đổi MST sang MST của
     partner khác công ty → OK · cùng công ty → lỗi · import vẫn đúng hành vi
     round 25 (test cũ xanh).
   - E2E (mở rộng partners.spec.ts): form thêm tay: MST trùng + tick công ty
     KHÁC → thêm thành công; MST trùng + tick công ty TRÙNG → thấy lỗi MST.
     Dọn dữ liệu test; KHÔNG đụng dữ liệu thật owner.
4) FULL GATE: pnpm build + FULL INTEGRATION + FULL E2E (mọi spec) → báo số
   liệu THẬT từng tầng. Dọn dẹp sau chạy (probe/junction 143 row thật giữ
   nguyên/audit test row/theme e2e.wave2 về null/port trống). Flake môi trường
   → chạy lại tối đa 2 lần, ghi rõ.
5) KHÔNG commit/push — chờ chốt.

BÁO CÁO 5 mục (đã làm + file; kết quả test thật; lệch + lý do; commit? chưa;
rủi ro/việc còn lại).
```

## 10. LƯU Ý KỸ THUẬT KHÁC (gotchas đã đúc kết)

- `updatePartner`/`updateContract` = partial (chỉ ghi key caller gửi — đừng biến thành full-row update).
- Import Excel: `parsePartnerWorkbook` nhận `ArrayBuffer | Uint8Array`; MIME gate có fallback đuôi `.xlsx` (Windows gửi octet-stream).
- `search_partners` RPC: `security invoker`, fold `unaccent` + `đ→d`, chỉ trả `status='active'`, LIMIT 50.
- Audit: `recordAudit` (service-role, swallow lỗi — không bao giờ chặn nghiệp vụ); `recordCurrentUserAudit` lấy actor từ session. Cột `audit_logs.actor_id` FK RESTRICT → khi xoá user phải purge audit rows trước (pattern `purgeAuditRowsForUser`).
- Delete entity: session client KHÔNG có quyền DELETE (hardening) → service-role; xoá hợp đồng = R2 objects → contract_files rows → contract (fail R2 = huỷ toàn bộ).
- Theme: `--background` mặc định light = `210 40% 98%` (slate-50); preset nền "gray/blue" gần giống default là chủ ý (giữ 6 preset). Menu active dùng `bg-primary/10 text-primary` (theo accent user).
- Git: MinGit tại `D:\HRP-app\tools\mingit\cmd\git.exe` (không nằm trong PATH); push cần full-access (TLS schannel bị sandbox chặn) — do T1/owner push, AI coding KHÔNG push.
- Sandbox T1: `pnpm`/vitest/playwright cần escalation (EPERM); đọc file UTF-8 dùng `[System.IO.File]::ReadAllText` (Get-Content đọc CP1252 gây mojibake).

## 11. Ý TƯỞNG TƯƠNG LAI (owner từng nhắc, chưa làm)

- Responsive: ẩn bớt cột bảng Đối tác trên màn hình hẹp.
- Pagination cho Đối tác → khi có thì chuyển bộ lọc client (R30) xuống server.
- Export CSV (hiện chỉ txt/xlsx) nếu owner yêu cầu.
- Cảnh báo thực tế khoá "Khu vực" trong chống trùng import (khoá yếu nhất — nếu gộp nhầm đối tác cùng miền thì bỏ khoá).
- Audit cho hành động export đối tác (hiện chưa ghi).
