# Hoàn tất gói sửa 14 hạng mục HRP

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

- Unit: **530/530**, 51 file; lint/typecheck/build đạt trên Next.js 16.4.1.
- PostgreSQL 17 cô lập: **51 migration** đạt, RLS/privilege, rollback đối tác/audit,
  1.200 tệp, 160 đối tác, concurrency và outbox retry/exhausted.
- Đúng bundle triển khai được thử trên baseline cũ có dữ liệu: cố ý gây lỗi xác nhận
  rollback nguyên tử, chạy lại hai lần và giữ nguyên fingerprint sáu bảng nghiệp vụ.
- Integration và E2E đầy đủ đang được xác nhận lại trước phát hành.
- S3 trong CI là dịch vụ Supabase S3 thật, không phải bằng chứng đã chạy trên Cloudflare R2.
  Bucket Cloudflare test riêng cần quyền được cấp riêng; không chạy test ghi vào bucket production.

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

Triển khai ứng dụng sau migration. `CRON_SECRET` đã được lưu cho Production Vercel;
chỉ có hiệu lực ở deployment mới. Cron bảo trì chạy hằng ngày theo `vercel.json`.
Theo dõi 503/exhausted và xử lý nguyên nhân trước khi reset attempts. Intent chỉ bao phủ
URL cấp sau bản sửa; object mồ côi lịch sử cần đối soát riêng theo chính sách vận hành.

Admin production tự quét QR và xác minh OTP theo [SETUP-2FA.md](SETUP-2FA.md).
Không đăng ký factor hộ người dùng hoặc đưa TOTP vận hành vào source/CI.
Trạng thái rollout đầy đủ sẽ được bổ sung sau khi xác minh bản production.
