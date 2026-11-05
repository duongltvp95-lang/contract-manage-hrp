# Hoàn tất gói sửa 14 hạng mục HRP

Cập nhật hoàn tất triển khai: **02/11/2026 (giờ Việt Nam)**.

> Chính sách F13/2FA trong biên bản này đã được người dùng thay đổi sau nghiệm thu:
> ứng dụng không sử dụng 2FA. Xem [thay đổi ngày 02/11](NO-2FA-2026-11-02.md).

Nhánh: `codex/fix-review-20261031`. Kế tiếp gói `94a77d7` đã sửa F01–F14 trong
[biên bản 31/10](FIXES-2026-10-31.md); [báo cáo gốc](REVIEW-2026-10-31.md) là lịch sử trước sửa.

## Các phần đã hoàn thiện thêm

- **F01:** UUID 11.1.1 và adapter minimatch 11.0.1 khắc phục hai advisory gián tiếp
  của ExcelJS. Kiểm thử API glob cũ, traversal và XLSX conditional formatting;
  không bỏ qua advisory. Audit dependency production: **0 advisory**.
- **F02/F04:** thu hồi cả grant trực tiếp anon/authenticated của RPC vận hành `exec_sql`,
  thêm guard service-role. Profile chỉ cho tự sửa tên và ba màu giao diện.
  Hai ACL hẹp đã được xác minh trên Supabase test rồi áp dụng production, không đổi dữ liệu.
- **F05:** giữ quy tắc mã số thuế cũ khi cập nhật đối tác không truyền danh sách công ty.
- **F10/F12:** Auth/export được nhận vào outbox bền vững trước khi trả thành công.
  Retry cùng UUID tránh ghi trùng khi mất ACK. Đăng nhập không hoàn tất sẽ thu hồi phiên
  vừa tạo; export trả 503 nếu chưa nhận được sự kiện. Cron retry có backoff, báo exhausted;
  receipt hoàn tất giữ 30 ngày. Logout vẫn best-effort để lỗi audit không cản thoát phiên.
- **F14:** CI tự dựng Supabase Auth/PostgREST/PG17 và S3 cô lập, chạy integration/E2E
  cả fork PR, không dùng production secret hoặc xanh do skip. Tắt log tham số Server Action
  chứa password/OTP. Artifact lỗi chỉ lấy thư mục Playwright, không lấy status/credential.
- Kiểm thử trình duyệt còn sửa reset đối tác sau lưu, giữ form khi upload lỗi,
  kiểm tra công ty trước cảnh báo ngày và bổ sung số hợp đồng gốc khi tải phụ lục.
  Phụ lục vẫn bắt buộc có tài liệu chính và số gốc khớp.

F03, F06–F09, F11, F13 giữ các kiểm tra tenant, ngân sách đăng nhập nguyên tử,
unique identity, view listing, ngày Việt Nam, upload intent và AAL2 của gói trước.

## Kiểm thử và giới hạn

- [CI phát hành #41329293900](https://github.com/duongltvp95-lang/contract-manage-hrp/actions/runs/41329293900):
  tất cả job success, source `095cb7d8d106c8085fc18782cc00487189e5fb5d`.
- Unit: **530/530**, 51 file; lint/typecheck/build đạt trên Next.js 16.4.1.
  Thêm 47 ca lịch chạy lại dưới Los Angeles, bộ unit đầy đủ chạy dưới UTC.
- PostgreSQL 17 cô lập: **51 migration** đạt, RLS/privilege, rollback đối tác/audit,
  1.200 tệp, 160 đối tác, concurrency và outbox retry/exhausted.
- Đúng bundle triển khai được thử trên baseline cũ có dữ liệu: cố ý gây lỗi xác nhận
  rollback nguyên tử, chạy lại hai lần và giữ nguyên fingerprint sáu bảng nghiệp vụ.
- Integration: **157/157**, 24 file. E2E Chromium: **111/111**, không skip/flaky.
  Ba placeholder phân quyền bị skip trước đây đã được thay bằng ca thực dùng tài khoản thường.
- S3 trong CI là dịch vụ Supabase S3 thật, không phải bằng chứng đã chạy trên Cloudflare R2.
  Theo yêu cầu người dùng ngày 02/11, bỏ nghiệm thu ghi bằng bucket Cloudflare riêng.
  Production R2 chỉ kiểm tra đọc bucket và HEAD ba tệp tham chiếu: đạt; không tạo fixture ở production.

## Tái chạy backend cô lập

```sh
mkdir -p test-results
pnpm dlx supabase@2.122.0 start --workdir tests/setup --exclude realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor > test-results/backend-start.log 2>&1
pnpm dlx supabase@2.122.0 status --workdir tests/setup --output json > test-results/backend-status.json
node scripts/setup-isolated-tests.mjs --status-json test-results/backend-status.json --database-container supabase_db_hrp-isolated-tests --local-storage --bucket hrp-review-test-ci
pnpm test:integration
pnpm test:e2e
```

Chạy integration và E2E tuần tự. Script tạo admin/TOTP dùng một lần và `.env.test.local`
được Git bỏ qua, không in credential. Không chia sẻ raw status/start log.
Nếu admin đã tồn tại, dùng cấu hình hiện có; `--reset-fixture` chỉ dành cho stack loopback
cô lập được script kiểm tra. Để thử Cloudflare riêng, dùng `--storage-env <private-file>`
thay `--local-storage`; bucket `hrp-review-test-*` phải có marker riêng và CORS loopback.

## Gói triển khai production

Gồm 7 migration ngày 31/10 và 4 file ngày 01/11. Bundle còn chạy lại forward repair
idempotent ngày 28/10 để sửa lệch quyền/trigger của database cũ, tổng cộng **12 entry**.

```sh
node scripts/deploy-review-migrations.mjs --env <private-HRP-env>
node scripts/deploy-review-migrations.mjs --env <private-HRP-env> --apply --evidence test-results/production-release.json
```

Mặc định chỉ in manifest/checksum. `--apply` giới hạn đúng project HRP, dùng RPC service-only,
khóa ghi ngắn, kiểm tra trùng và chạy một transaction với fingerprint trước/sau.
Không tự gộp/xóa hợp đồng. Receipt/checksum/schema trước phát hành ở `hrp_private`,
không lộ qua Data API; receipt không thay thế backup database theo quy trình vận hành.

Gói 12 entry đã áp dụng production lúc **23:48:34 ngày 01/11/2026 (UTC+7)**;
receipt `review-20261101` xác nhận fingerprint sáu bảng trước/sau bằng nhau.
Kiểm tra HTTP ẩn danh: RPC SQL, audit outbox và listing đều 401, không trả dữ liệu.

Ứng dụng đã được promote từ nhánh sửa, build lại bằng môi trường Production và Ready:
[deployment 4BeZ2f2rtAeDnxn8HG5khaHVfdvU](https://vercel.com/hrp6/contract-manage-hrp/4BeZ2f2rtAeDnxn8HG5khaHVfdvU),
source `095cb7d`, gán [cm.hrpartner.vn](https://cm.hrpartner.vn).
Không merge hoặc push `main`. Commit tài liệu sau phát hành không đổi source ứng dụng đã nghiệm thu.

Smoke production sau rollout: `/login` 200, `/contracts` 307 về login, `/auth/mfa`
chặn phiên ẩn danh qua redirect trong HTML streaming; API xem/tải tệp, export log và cron
không xác thực đều 401. CSP không có unsafe-eval, có frame-ancestors 'none', X-Frame-Options DENY
và nosniff. Không đăng nhập bằng tài khoản vận hành để tạo dữ liệu thử.

`CRON_SECRET` đã được lưu cho Production và bản deployment mới dùng môi trường này.
Cron bảo trì chạy hằng ngày theo `vercel.json` (02:00 UTC, 09:00 Việt Nam).
Không kích hoạt thủ công lệnh xóa tệp production trong nghiệm thu; bốn intent cleanup cũ
không tham chiếu tệp DB được để cho quy trình bảo trì thông thường, không có job exhausted.
Theo dõi 503/exhausted và xử lý nguyên nhân trước khi reset attempts. Intent chỉ bao phủ
URL cấp sau bản sửa; object mồ côi lịch sử cần đối soát riêng theo chính sách vận hành.

Admin production tự quét QR và xác minh OTP theo [SETUP-2FA.md](SETUP-2FA.md).
Không đăng ký factor hộ người dùng hoặc đưa TOTP vận hành vào source/CI.
Backend test Docker riêng đã được dừng sau nghiệm thu. Credential test và mã cron kiểm tra
không được commit; biên bản JSON và ảnh xác nhận nằm trong `test-results/` bị Git bỏ qua.
