# BÀN GIAO VỊ TRÍ T2 — DỰ ÁN CONTRACT MANAGER

> Tài liệu dành cho **T2 mới (AI Coder / Pair Programmer)** tiếp quản. Đọc hết trước khi nhận việc.
>
> **Lần cập nhật:** 2026-10-15 (Snapshot sau Round 39, branch `main`)
> **Người viết:** T1 / Owner & AI Assistant
> **Trạng thái:** Wave 1 + Round 2 → 39 **ĐÃ MERGE & DEPLOY**. Working tree **sạch hoàn toàn, KHÔNG có task nào dở**.
> 
> File này **không** chứa mật khẩu / PAT / `service_role` / R2 secret. Mọi bí mật nằm trong `.env.local`.

---

## 0. TỔNG QUAN HIỆN TRẠNG CHO T2 MỚI TIẾP QUẢN

Khi nhận việc, bạn đang tiếp quản một hệ thống đã hoàn thiện tính năng cốt lõi, bảo mật tăng cường và đang chạy production ổn định:

| Hạng mục | Trạng thái thực tế |
|---|---|
| **App** | Contract Manager — quản lý hợp đồng và danh bạ đối tác cho **HRP / HR VN**. |
| **Production chính** | `https://cm.hrpartner.vn` (DNS CNAME → Vercel) |
| **Production phụ** | `https://contract-manage-hrp.vercel.app` (Vercel auto-deploy từ `main`) |
| **Trạng thái Git** | Nhánh `main` sạch hoàn toàn, đồng bộ với remote GitHub `duongltvp95-lang/contract-manage-hrp`. |
| **Dữ liệu thật** | **144 đối tác** (123 đang hợp tác, 21 đã dừng), **0 hợp đồng** (đã dọn dẹp sạch), **1.120+ dòng audit log**. |
| **Tài khoản thật** | Owner `duongltvp95@gmail.com` (Admin, Enforce 2FA/MFA), user nội bộ `duongamo10300@gmail.com` (User). |
| **Bộ kiểm thử** | **343 Unit tests (28 test files - 100% pass)**, 27 Integration test files, 18 E2E spec files. |

### Các phân hệ cốt lõi & cải tiến mới nhất:
1. **Quản lý Hợp đồng**: CRUD, vòng đời trạng thái (Đang hoạt động / Đã hết hạn / Đã lưu trữ), liên kết công ty (`contracts.company_id`), tải tệp PDF/Ảnh trực tiếp lên Cloudflare R2 qua presigned URL, trình xem tệp 65/35 (`react-pdf`).
2. **Danh bạ Đối tác**: Quản lý thông tin, liên kết công ty N-N (`partner_companies` với HRP/HR VN), chống trùng 5 khoá khi import Excel (`MST → Viết tắt → Tên → Địa chỉ → Khu vực`), kiểm tra trùng MST theo công ty trên form tay, bộ lọc cột kiểu Excel trực tiếp trên header bảng (popover multi-select), xuất danh bạ ra file Excel.
3. **Phân quyền & Xoá dữ liệu**:
   - Xoá hợp đồng & đối tác: Chỉ dành cho **admin đặc quyền** (`DELETE_ADMIN_EMAILS`, mặc định Owner). Xoá hợp đồng bắt buộc xoá tệp R2 trước (fail R2 = huỷ toàn bộ); xoá đối tác bị chặn khi còn hợp đồng.
   - Xoá người dùng: Admin only, áp dụng cơ chế **tombstone** (`profiles.is_tombstone = true`) để bảo toàn khoá ngoại tham chiếu từ `audit_logs.actor_id`.
4. **Bảo mật Đăng nhập & Rate Limit (Round 38)**:
   - Cơ chế phòng thủ 3 tầng: Supabase Rate Limit (chặn theo IP) + Server Cookie + Client UI Lockout.
   - Khi nhập sai mật khẩu 5 lần: Nút Đăng nhập bị **KHÓA CỨNG 15 phút** (`disabled`), hiển thị đồng hồ đếm ngược từng giây và lưu bền vững vào `localStorage` (F5 không mất trạng thái khóa).
   - Hỗ trợ chuyển sang thử **tối đa 1 tài khoản khác duy nhất** (nếu cố tình thử tài khoản thứ 3 sẽ bị chặn đứng).
   - Cung cấp nút mở khóa nhanh: *"Đặt lại mật khẩu để mở khóa ngay"*.
5. **Bảo mật Hệ thống & Content-Security-Policy (Round 39)**:
   - Bổ sung Security Headers & CSP chặt chẽ trong `next.config.ts`: Chống XSS inline injection, clickjacking (`frame-ancestors 'none'`), MIME sniffing, và chỉ whitelist kết nối Supabase, Cloudflare R2, Google Fonts.
6. **Nhật ký Hệ thống (Audit Logs - Round 39)**:
   - Ghi nhận 18 loại hành động nghiệp vụ với câu mô tả tiếng Việt chi tiết; hỗ trợ xuất file Excel/Text.
   - **Mới bổ sung**: Ghi nhận hành động `export_partners` (xuất danh bạ đối tác) để hoàn thiện audit trail.
7. **Giao diện & Theme chuẩn thương hiệu**:
   - Tích hợp bảng màu mới Slate & Indigo (`#312E81`, `#4338CA`, `#FEFCE8`, `#9A3412`), các alert cảnh báo và nút bấm đồng bộ theo design system.

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
Node.js và pnpm có thể không nằm trong biến môi trường PATH mặc định:
- **Node.js**: `C:\Users\Admin\AppData\Local\Programs\aicoworker\resources\node\node.exe` (v22)
- **pnpm**: `C:\Users\Admin\AppData\Roaming\dsh-desktop\harness\.desktop-bin\pnpm.cmd`
- **Cách thiết lập PATH trước khi chạy lệnh PowerShell**:
  ```powershell
  $env:PATH = "C:\Users\Admin\AppData\Roaming\dsh-desktop\harness\.desktop-bin;" + $env:PATH
  ```

### 3.2 Lỗi Windows ACL Deny trên `.next*` & Cách khắc phục tự động
Thư mục `.next`, `.next-test`, `.next-e2e` trên máy Windows từng bị dính quyền Deny:
- **Giải pháp triệt để 1-click**: Đã có script tự động:
  ```powershell
  .\scripts\fix-workspace-acl.ps1
  ```
  Script sẽ tự động gỡ sạch cờ Deny và cấp lại toàn quyền Full Control cho người dùng hiện tại.

### 3.3 CI/CD Deployment Guard (Auto-Deploy Guard)
- Workflow `.github/workflows/ci.yml` được trang bị job `deploy-guard`.
- Job này chạy cuối cùng và xác nhận cả 3 khối `quality`, `integration` và `e2e` đều phải xanh (passed 100%). Nếu có bất kỳ bài test nào fail, deployment guard sẽ chặn đứng bản release.

---

## 4. QUY TRÌNH LÀM VIỆC (RULE BẮT BUỘC)

Tuân thủ nghiêm ngặt:
1. **Ngôn ngữ 100% Tiếng Việt**: Mọi giải thích, trao đổi và tài liệu dùng tiếng Việt chuẩn.
2. **Không rò rỉ Credential**: Không bao giờ in ra chat hoặc log các khoá bí mật (`SUPABASE_SERVICE_ROLE_KEY`, `R2_SECRET_ACCESS_KEY`, mật khẩu).
3. **REUSE FIRST**: Ưu tiên tái sử dụng code có sẵn trong repo -> shadcn/ui -> thư viện ngoài -> mới tự viết.
4. **Không tự ý git push**: Luôn xin xác nhận của Owner trước khi `git push origin main`.
5. **Kiểm tra Gate trước khi bàn giao**: Luôn chạy test, typecheck, lint và build trước khi tạo commit.

---

## 5. BACKLOG CÁC NHIỆM VỤ DÀI HẠN (P2 & P3)

Dành cho giai đoạn mở rộng quy mô khi hệ thống đạt > 1.000 hợp đồng và đối tác:

| Ưu tiên | Nhiệm vụ | Phạm vi & Mục tiêu |
|---|---|---|
| **P2** | **Refactor `lib/services/contracts.ts`** | Tách file lớn (~990 dòng) thành module con (`queries.ts`, `mutations.ts`, `delete.ts`) để dễ bảo trì. |
| **P2** | **Pagination cho `/partners`** | Khi danh bạ đối tác vượt 500 – 1.000 dòng, chuyển từ client-side filtering sang server-side pagination qua URL params. |
| **P2** | **Helper `getAdminOrFail()`** | Gom cụm try-catch gọi service-role client trong `users.ts` để tái sử dụng gọn gàng. |
| **P3** | **Observability / Sentry** | Tích hợp công cụ giám sát lỗi tập trung cho môi trường Production (Sentry hoặc Datadog). |
| **P3** | **Rate Limit cho Server Actions** | Bổ sung middleware rate limit cho các mutation server actions để chống spam request. |
