# BÀN GIAO VỊ TRÍ T2 — DỰ ÁN CONTRACT MANAGER

> Tài liệu dành cho **T2 mới (AI Coder / Pair Programmer)** tiếp quản. Đọc hết trước khi nhận việc đầu tiên.
>
> **Lần cập nhật:** 2026-10-11 (Snapshot sau Round 37, commit `034a108`)
> **Người viết:** T1 (Owner/điều phối)
> **Trạng thái:** Wave 1 + Round 2 → 37 **ĐÃ MERGE & DEPLOY**. Working tree **sạch hoàn toàn, KHÔNG có task nào dở**.
> 
> File này **không** chứa mật khẩu / PAT / `service_role` / R2 secret. Mọi bí mật nằm trong `.env.local`.

---

## 0. TỔNG QUAN HIỆN TRẠNG CHO T2 MỚI TIẾP QUẢN

Khi nhận việc, bạn đang tiếp quản một hệ thống đã hoàn thiện tính năng cốt lõi và đang chạy production ổn định:

| Hạng mục | Trạng thái thực tế |
|---|---|
| **App** | Contract Manager — quản lý hợp đồng và danh bạ đối tác cho **HRP / HR VN**. |
| **Production chính** | `https://cm.hrpartner.vn` (DNS CNAME → Vercel) |
| **Production phụ** | `https://contract-manage-hrp.vercel.app` (Vercel auto-deploy từ `main`) |
| **Trạng thái Git** | Nhánh `main` sạch hoàn toàn, đồng bộ với remote. |
| **Dữ liệu thật** | **144 đối tác** (123 đang hợp tác, 21 đã dừng), **0 hợp đồng** (đã dọn dẹp sạch), **1.118+ dòng audit log**. |
| **Tài khoản thật** | Owner `duongltvp95@gmail.com` (Admin), user nội bộ `duongamo10300@gmail.com` (User). |
| **Bộ kiểm thử** | 272 Unit tests (100% pass), 27 Integration test files, 18 E2E spec files. |

### Các phân hệ cốt lõi đã hoàn thành:
1. **Quản lý Hợp đồng**: CRUD, vòng đời trạng thái (Đang hoạt động / Đã hết hạn / Đã lưu trữ), liên kết công ty (`contracts.company_id` ở Round 37), tải tệp PDF/Ảnh trực tiếp lên Cloudflare R2 qua presigned URL, trình xem tệp 65/35 (`react-pdf`).
2. **Danh bạ Đối tác**: Quản lý thông tin, liên kết công ty N-N (`partner_companies` với HRP/HR VN), chống trùng 5 khoá khi import Excel (`MST → Viết tắt → Tên → Địa chỉ → Khu vực`), kiểm tra trùng MST theo công ty trên form tay, bộ lọc cột kiểu Excel trực tiếp trên header bảng (Round 37 popover multi-select).
3. **Phân quyền & Xoá dữ liệu**:
   - Xoá hợp đồng & đối tác: Chỉ dành cho **admin đặc quyền** (`DELETE_ADMIN_EMAILS`, mặc định Owner). Xoá hợp đồng bắt buộc xoá tệp R2 trước (fail R2 = huỷ toàn bộ); xoá đối tác bị chặn khi còn hợp đồng.
   - Xoá người dùng: Admin only, áp dụng cơ chế **tombstone** (`profiles.is_tombstone = true`) để bảo toàn khoá ngoại tham chiếu từ `audit_logs.actor_id`.
4. **Nhật ký Hệ thống (Audit Logs)**: Ghi 13 loại hành động nghiệp vụ với câu mô tả tiếng Việt chi tiết; hỗ trợ xuất file Excel/Text.
5. **Theme cá nhân hoá**: 3 bộ màu (accent, background, sidebar) lưu tại `profiles`, áp dụng qua `data-*` attribute trên root layout, không gây giật màn hình (no FOUC).

---

## 1. TÀI KHOẢN TEST BẮT BUỘC PHẢI TỒN TẠI

Cả `vitest` (integration) và `playwright` (e2e) đều kiểm thử trên **Supabase + R2 thật** (không mock).
Tài khoản test bắt buộc:

| Thuộc tính | Giá trị |
|---|---|
| **Email** | `e2e.wave2@hrpartner.vn` |
| **Mật khẩu** | Lưu trong `.env.local` (`TEST_ADMIN_PASSWORD`), **không in ra ngoài** |
| `email_confirmed_at` | Khác null (đã xác thực) |
| `profiles.role` | `admin` |
| `profiles.organization_id` | `11111111-1111-1111-1111-111111111111` (ORG_A) |
| `profiles.is_active` | `true` |

> ⚠️ **TUYỆT ĐỐI KHÔNG XOÁ** tài khoản `e2e.wave2@hrpartner.vn`. Nếu tài khoản này mất, toàn bộ suite e2e/integration sẽ fail ở bước đăng nhập.

### Cách khôi phục nếu lỡ bị xoá:
Sử dụng script service-role:
1. `auth.admin.createUser({ email: 'e2e.wave2@hrpartner.vn', password, email_confirm: true })`
2. `profiles.update({ role: 'admin', organization_id: ORG_A, is_active: true })`
3. Xác minh đăng nhập bằng `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`.

---

## 2. TUYỆT ĐỐI KHÔNG ĐỤNG DỮ LIỆU THẬT CỦA OWNER

- Tài khoản `duongltvp95@gmail.com` (Khương Văn Đường) là tài khoản thật của Owner.
- Tuyệt đối **không dùng** tài khoản Owner cho test E2E.
- Dữ liệu của Owner (144 đối tác thật, cấu hình theme cá nhân) **không được xoá hoặc sửa đổi**.
- Khi chạy kiểm thử, mọi bản ghi tạo mới **bắt buộc dùng tiền tố** `E2ETEST-` hoặc `W1TEST-`. Suite kiểm thử có helper `sweep()` tự động dọn các bản ghi có tiền tố này sau mỗi lần chạy.

---

## 3. MÔI TRƯỜNG VẬN HÀNH & GOTCHA TRÊN MÁY CỦA OWNER

Để không mất thời gian cấu hình, T2 cần lưu ý các đặc thù môi trường Windows của Owner:

### 3.1 Đường dẫn thực thi (Runtime paths)
Node.js và pnpm không nằm trong biến môi trường PATH mặc định của hệ điều hành:
- **Node.js**: `C:\Users\Admin\AppData\Local\Programs\aicoworker\app\nodejs\node.exe` (v22)
- **pnpm**: `C:\Users\Admin\AppData\Roaming\dsh-desktop\harness\.desktop-bin\pnpm.cmd`
- **Cách thiết lập PATH trước khi chạy lệnh PowerShell**:
  ```powershell
  $env:PATH = "C:\Users\Admin\AppData\Local\Programs\aicoworker\app\nodejs;C:\Users\Admin\AppData\Roaming\dsh-desktop\harness\.desktop-bin;" + $env:PATH;
  ```

### 3.2 Lỗi Windows ACL Deny trên `.next*` (Quan trọng)
Thư mục `.next`, `.next-test`, `.next-e2e` trên máy Owner từng bị dính ACL `Everyone Deny DeleteSubdirectoriesAndFiles`.
- Khiến `next dev` và `next build` mặc định bị lỗi `EPERM` khi rename/unlink file manifest.
- **Cách vòng cho build**: Dùng `$env:NEXT_DIST_DIR = ".next-verify"; pnpm next build` (thư mục mới không kế thừa deny).
- **Lưu ý**: Sau khi Owner chạy gỡ deny bằng `icacls`, toàn bộ lệnh test dev sẽ hoạt động bình thường.

---

## 4. QUY TRÌNH LÀM VIỆC (RULE BẮT BUỘC)

Tuân thủ nghiêm ngặt file quy tắc `.cursor/rules/agent-working-rules.mdc`:

1. **Ngôn ngữ 100% Tiếng Việt**: Mọi giải thích, trao đổi, commit message và tài liệu phải dùng tiếng Việt chuẩn (thuật ngữ kỹ thuật giữ nguyên).
2. **Không rò rỉ Credential**: Không bao giờ in ra chat hoặc log các khoá bí mật (`SUPABASE_SERVICE_ROLE_KEY`, `R2_SECRET_ACCESS_KEY`, mật khẩu).
3. **REUSE FIRST**: Ưu tiên tái sử dụng code có sẵn trong repo -> shadcn/ui -> thư viện ngoài -> mới tự viết.
4. **Không tự ý đổi quyết định Owner**: Báo cáo rõ ràng nếu phát hiện lỗi hoặc đề xuất giải pháp.
5. **Báo cáo 5 mục bắt buộc sau mỗi task**:
   * (1) Đã làm (kèm danh sách file/commit)
   * (2) Kết quả kiểm chứng THẬT (lệnh đã chạy, kết quả pass/fail cụ thể)
   * (3) Lệch so với prompt (nếu có, kèm lý do)
   * (4) Tự động commit/push? (**Chưa** - luôn chờ Owner duyệt)
   * (5) Vấn đề còn lại & rủi ro

---

## 5. BACKLOG CÁC NHIỆM VỤ TIẾP THEO (ROUND 33+)

Dựa trên bản review toàn diện ngày 2026-10-11 (`docs/REVIEW-2026-10-11.md`), các hạng mục nợ kỹ thuật và cải tiến được sắp xếp theo thứ tự ưu tiên:

| Ưu tiên | Nhiệm vụ | Phạm vi & Mục tiêu |
|---|---|---|
| **Cao** | **Refactor `partners-table.tsx`** | Tách file bảng lớn (~640 dòng) thành các Custom Hooks (`usePartnerTableFilters`, `usePartnerSelection`) và sub-components con, giữ nguyên 100% hành vi và testid. |
| **Cao** | **Refactor `contract-form.tsx`** | Tách form lớn (~780 dòng) thành các sub-components (Upload section, Company selector), giảm độ phức tạp state. |
| **Trung bình** | **DB RPC Aggregation** | Chuyển việc đếm số tệp và số hợp đồng từ kéo dữ liệu về JS memory sang PostgreSQL Function an toàn với `security invoker = true`. |
| **Trung bình** | **Pagination cho Đối tác** | Chuẩn bị hạ tầng phân trang server-side cho danh bạ đối tác khi dữ liệu mở rộng. |
| **Thấp** | **Error Catalog** | Chuẩn hoá bảng mã lỗi và câu thông báo tiếng Việt tập trung tại `lib/errors/catalog.ts`. |
| **Thấp** | **Tuning Vitest Timeout** | Tăng `testTimeout: 15000` cho `tests/unit/partner-import.test.ts` để tránh lỗi timeout do ExcelJS khởi động nguội. |
| **UX** | **Tinh chỉnh nút Xuất Excel** | Bổ sung tooltip hoặc hợp nhất 3 nút xuất đối tác trong dropdown thành 1 nút trực quan. |
