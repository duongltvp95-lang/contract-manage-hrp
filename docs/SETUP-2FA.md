# HƯỚNG DẪN THIẾT LẬP VÀ BẮT BUỘC 2FA (MFA) CHO TÀI KHOẢN ADMIN

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

## 2. HƯỚNG DẪN BẬT 2FA CHO TÀI KHOẢN OWNER / ADMIN TRÊN DASHBOARD

### Bước 1: Truy cập Supabase Dashboard
1. Đăng nhập vào trang quản trị Supabase: `https://supabase.com/dashboard/project/vohrerrbthbrkwjllnlj`
2. Chọn menu bên trái: **Authentication** $\rightarrow$ **Users**.

### Bước 2: Bật Enforce MFA cho User
1. Tìm tài khoản Owner: `duongltvp95@gmail.com`
2. Bấm vào dấu `...` (Actions) ở góc phải của dòng người dùng.
3. Chọn **Enforce MFA**:
   * Khi bật tùy chọn này, tài khoản khi đăng nhập sẽ bắt buộc phải hoàn thành bước AAL2 (quét mã QR và nhập mã OTP).

---

## 3. CÁCH HOẠT ĐỘNG TRONG CODE (AAL2 RLS ENFORCEMENT)

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

Khi chính sách này được áp dụng, bất kỳ API nào gọi bằng token AAL1 (chưa qua 2FA) sẽ bị cơ sở dữ liệu chặn đứng ngay lập tức từ tầng mạng PostgreSQL.

---

## 4. CHECKLIST BẢO MẬT BẮT BUỘC CHO OWNER

* [x] **Rate Limit đăng nhập**: Đã bật trên Supabase Dashboard + Giới hạn 5 lần sai khóa 15 phút.
* [x] **Enforce MFA**: Bật cho tài khoản Owner `duongltvp95@gmail.com`.
* [x] **CSP Headers**: Đã cấu hình chặn script lạ từ bên ngoài trong `next.config.ts`.
* [x] **Audit Log**: Ghi vết 18 hành động nghiệp vụ (bao gồm xuất Excel).
