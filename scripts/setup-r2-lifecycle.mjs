/**
 * Cloudflare R2 Lifecycle Configuration Guide & Ops Script
 *
 * Tệp tạm trích xuất AI được lưu với tiền tố: `ai-temp/{orgId}/{fileId}/{filename}`.
 * Để tránh rò rỉ dung lượng và chi phí lưu trữ trên Cloudflare R2, bucket `hrp-contract`
 * cần được thiết lập Lifecycle Rule tự động xóa các object sau 24 giờ.
 *
 * HƯỚNG DẪN CẤU HÌNH TRÊN CLOUDFLARE DASHBOARD:
 * --------------------------------------------------
 * 1. Đăng nhập vào Cloudflare Dashboard: https://dash.cloudflare.com
 * 2. Chọn R2 Object Storage -> Click vào Bucket: `hrp-contract`
 * 3. Chuyển sang tab: `Settings` (Cài đặt)
 * 4. Cuộn xuống phần: `Object lifecycle rules` (Quy tắc vòng đời đối tượng) -> Bấm `Add rule`
 * 5. Điền thông tin quy tắc:
 *    - Rule name: `auto-delete-ai-temp-24h`
 *    - Apply to: `Objects with a specific prefix`
 *    - Prefix: `ai-temp/`
 *    - Action: `Delete object after` -> `1 day`
 * 6. Bấm `Save rule` để áp dụng.
 */

console.log("=== CLOUDFLARE R2 LIFECYCLE GUIDE ===");
console.log("1. Vào Cloudflare Dashboard -> R2 -> Bucket 'hrp-contract'");
console.log("2. Settings -> Object lifecycle rules -> Add rule");
console.log("3. Prefix: 'ai-temp/' -> Delete after 1 day -> Save rule.");
console.log("=====================================");
