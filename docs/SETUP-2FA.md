# Ứng dụng không sử dụng 2FA

Cập nhật theo yêu cầu người dùng ngày 02/11/2026.

Đăng nhập HRP dùng email và mật khẩu cho cả admin và người dùng thường.
Không yêu cầu đăng ký ứng dụng xác thực, quét QR hoặc nhập OTP.
Trang cũ `/auth/mfa` chuyển về Cài đặt và không còn chức năng đăng ký/xác thực.

Quản lý người dùng, xóa/bỏ lưu trữ và bảo trì vẫn kiểm tra phiên đăng nhập,
quyền admin/Owner, tổ chức và các ràng buộc nghiệp vụ; không yêu cầu AAL2.
Cron tự động dùng Bearer `CRON_SECRET` của máy chủ như trước.

Các migration đã áp dụng và nhãn audit `verify_mfa` được giữ cho lịch sử;
không sửa migration cũ hoặc tự xóa factor tài khoản ở dịch vụ xác thực.
Kiểm thử không đăng ký TOTP và không cần `TEST_ADMIN_TOTP_SECRET`.

Thay đổi áp dụng cho ứng dụng HRP. Xác thực tài khoản quản lý Vercel/Supabase là cơ chế riêng.
Xem [biên bản thay đổi](NO-2FA-2026-11-02.md).
