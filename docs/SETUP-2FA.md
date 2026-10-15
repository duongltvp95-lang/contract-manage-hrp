# HƯỚNG DẪN THIẾT LẬP VÀ XÁC THỰC 2FA (MFA) CHO TÀI KHOẢN ADMIN

> Tài liệu hướng dẫn quản trị viên bảo mật tài khoản bằng Xác thực hai yếu tố (2-Factor Authentication - TOTP) trên Supabase.

---

## 1. TỔNG QUAN VỀ 2FA (MFA) TRÊN SUPABASE

Hệ thống HRP Contract Manager sử dụng **Supabase Auth** làm tầng xác thực gốc. Supabase hỗ trợ tiêu chuẩn **MFA qua ứng dụng Authenticator (TOTP)** tương thích với:
* **Google Authenticator**
* **Microsoft Authenticator**
* **Authy** / **1Password** / **Bitwarden**

Supabase phân cấp độ bảo mật xác thực thành 2 cấp độ (**AAL - Authenticator Assurance Level**):
1. **AAL1**: Đăng nhập bằng Email + Mật khẩu (Cấp độ cơ bản).
2. **AAL2**: Đăng nhập bằng Email + Mật khẩu **và** đã nhập mã OTP 6 số từ ứng dụng xác thực.

---

## 2. HƯỚNG DẪN ĐĂNG KÝ VÀ BẬT 2FA CHO TÀI KHOẢN OWNER

Để tài khoản đạt chuẩn 2FA thật sự (không chỉ là bật cấu hình rỗng), Owner cần hoàn tất 2 bước:

### Bước 1: Quét mã QR vào ứng dụng Authenticator (Enroll Factor)
1. Đăng nhập vào trang quản trị Supabase: `https://supabase.com/dashboard/project/vohrerrbthbrkwjllnlj`
2. Chọn menu bên trái: **Authentication** $\rightarrow$ **Users**.
3. Chọn tài khoản Owner: `duongltvp95@gmail.com`.
4. Tại mục **Multi-Factor Authentication (MFA)**, chọn **Add Factor** / **Enroll TOTP** $\rightarrow$ Dùng Google Authenticator trên điện thoại quét mã QR và nhập 6 số xác nhận.

### Bước 2: Bật Enforce MFA
1. Sau khi đã thêm Factor thành công, bấm vào dấu `...` ở góc phải của tài khoản Owner.
2. Chọn **Enforce MFA**. Từ thời điểm này, mỗi lần đăng nhập hệ thống sẽ yêu cầu mã OTP 6 số.

---

## 3. CÔNG CỤ TỰ ĐỘNG KIỂM TRA TRẠNG THÁI 2FA (VERIFICATION ARTIFACT)

Hệ thống đã tích hợp sẵn công cụ kiểm tra trạng thái 2FA thực tế của Owner:

```bash
node scripts/verify-2fa-status.mjs
```

### Kết quả mẫu khi ĐÃ HOÀN TẤT:
```text
> Tài khoản: duongltvp95@gmail.com (ID: 495eb514-82d9-4969-a610-760947a0a79d)
  - Trạng thái 2FA (MFA Factors): ĐÃ BẬT (1 factor)
    [Factor #1] Loại: totp | Tên: Google Authenticator | Trạng thái: verified
```

---

## 4. CÁCH HOẠT ĐỘNG TRONG CODE (AAL2 RLS ENFORCEMENT)

Nếu muốn bắt buộc các thao tác nhạy cảm (như xoá dữ liệu, cấu hình hệ thống) phải đạt chứng chỉ AAL2 ở tầng cơ sở dữ liệu PostgreSQL, Supabase cung cấp hàm kiểm tra JWT:

```sql
-- Ví dụ kiểm tra AAL2 trong chính sách RLS:
create policy "Chỉ admin đã xác thực 2FA mới được thực hiện thao tác nhạy cảm"
  on public.audit_logs
  for delete
  to authenticated
  using (
    (auth.jwt() ->> 'aal') = 'aal2'
  );
```

---

## 5. CHECKLIST BẢO MẬT HIỆN TẠI

* [x] **Rate Limit đăng nhập**: Đã bật trên Supabase Dashboard + Giới hạn 5 lần sai khóa 15 phút.
* [x] **Cơ chế 1 tài khoản thay thế**: Cho phép thử tối đa 1 tài khoản phụ khi tài khoản chính bị khóa.
* [x] **CSP Headers**: Đã cấu hình phân tách Dev/Prod, loại bỏ `unsafe-eval` ở Production.
* [x] **Audit Log**: Ghi vết 18 hành động nghiệp vụ (bao gồm xuất danh bạ đối tác ra Excel).
* [x] **Công cụ Verify 2FA**: Sẵn sàng tại `scripts/verify-2fa-status.mjs`.
* [ ] **Enforce 2FA/TOTP Owner**: Chờ Owner quét mã QR đăng ký factor vào Authenticator trên điện thoại (hiện tại `factors: 0`).
