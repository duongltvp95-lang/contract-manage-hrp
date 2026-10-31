# Thiết lập xác thực hai bước (TOTP)

Ứng dụng có luồng đăng ký và xác thực tại `/auth/mfa`, dùng Supabase Auth MFA.
Không cần tìm nút đăng ký TOTP thay người dùng trong Dashboard. Không suy ra
trạng thái production từ mã nguồn hoặc từ số factor đã đăng ký.

## Đăng ký lần đầu

1. Đăng nhập bằng email và mật khẩu. Tài khoản admin được chuyển đến **Bảo mật 2FA**;
   người dùng khác có thể mở **Cài đặt → Bảo mật 2FA**.
2. Chọn **Thiết lập ứng dụng xác thực**. Quét QR bằng ứng dụng hỗ trợ TOTP.
   Có thể mở **Nhập khóa thủ công** nếu không quét được QR.
3. Nhập mã OTP sáu chữ số và chọn **Xác thực và tiếp tục**.
4. Chỉ khi Supabase xác nhận thành công, factor mới là `verified` và phiên mới đạt AAL2.

QR và khóa TOTP chỉ nằm trong trạng thái giao diện khi thiết lập. Không gửi khóa
qua chat/email, đưa vào source, log, hoặc chụp QR vào tài liệu vận hành.
Nếu bỏ dở trước xác nhận, mở lại luồng thiết lập sẽ thay factor TOTP chưa xác minh
của chính tài khoản; ứng dụng không tự xóa factor đã xác minh.

## Các lần đăng nhập sau

Sau mật khẩu, admin và tài khoản có factor MFA đã đăng ký được chuyển đến
`/auth/mfa`. Nhập OTP từ ứng dụng đã liên kết. Luồng xác thực thành công đưa về
Cài đặt; có thể tiếp tục đến trang cần sử dụng.

Các service quản trị người dùng (bao gồm reset mật khẩu), xóa hợp đồng/đối tác,
bỏ lưu trữ hợp đồng và chạy dọn storage thủ công yêu cầu **phiên AAL2 hiện tại**,
đồng thời vẫn kiểm tra quyền admin/Owner tương ứng. Phiên AAL1 nhận `mfa_required`.
Chỉ có factor, kể cả `verified`, không đồng nghĩa phiên hiện tại đã đạt AAL2.
Cron máy chủ vẫn dùng Bearer `CRON_SECRET` riêng.

Các thao tác này đi qua máy chủ với service key; key không được cấp cho trình duyệt.
Đây là kiểm tra AAL2 tại service ứng dụng, không phải tuyên bố mọi bảng RLS đều bắt
buộc MFA. Các quyền đọc/ghi thông thường vẫn dùng RLS theo tổ chức và trạng thái tài khoản.

## Kiểm tra và khôi phục

`node scripts/verify-2fa-status.mjs` là công cụ đọc bằng quyền quản trị. Chỉ chạy
trong môi trường vận hành được cấp phép; công cụ chỉ xác nhận factor TOTP
`verified`, không xác nhận phiên AAL2 hoặc việc bắt buộc MFA trên toàn hệ thống.

Khi mất thiết bị, quản trị viên vận hành cần xác minh danh tính qua quy trình nội bộ
trước khi reset factor bằng công cụ quản trị Supabase, thu hồi phiên và yêu cầu
người dùng đăng ký lại. Reset mật khẩu riêng lẻ không thay thế việc khôi phục MFA.
Ứng dụng không cung cấp nút bỏ qua OTP hoặc tự xóa factor đã xác minh.

Trước triển khai, áp dụng các migration trong [hướng dẫn phát hành](FIXES-2026-10-31.md),
kiểm tra admin AAL1 bị từ chối và AAL2 thực hiện được đúng quyền trên môi trường test.
Với CI, chỉ dùng TOTP của tài khoản test riêng; xem `.env.test.example`.
