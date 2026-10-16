/**
 * Cloudflare R2 Lifecycle Configuration Guide & Ops Script
 *
 * CẢNH BÁO QUAN TRỌNG VỀ AN TOÀN DỮ LIỆU:
 * --------------------------------------------------
 * Tệp tạm trích xuất AI được lưu với tiền tố: `ai-temp/{orgId}/{fileId}/{filename}`.
 * Tệp hợp đồng chính thức được lưu với tiền tố: `contracts/{orgId}/{contractId}/{fileId}/{filename}`.
 *
 * TUYỆT ĐỐI KHÔNG để trống trường Prefix khi tạo Lifecycle Rule!
 * Nếu để trống Prefix hoặc chọn "All objects in the bucket", Cloudflare R2 sẽ TỰ ĐỘNG
 * XÓA VĨNH VIỄN toàn bộ tệp hợp đồng sau 24h!
 *
 * HƯỚNG DẪN CẤU HÌNH TRÊN CLOUDFLARE DASHBOARD:
 * --------------------------------------------------
 * 1. Đăng nhập vào Cloudflare Dashboard: https://dash.cloudflare.com
 * 2. Chọn R2 Object Storage -> Click vào Bucket: `hrp-contract`
 * 3. Chuyển sang tab: `Settings` (Cài đặt)
 * 4. Cuộn xuống phần: `Object lifecycle rules` (Quy tắc vòng đời đối tượng)
 *    - KIỂM TRA QUY TẮC HIỆN CÓ: Nếu thấy quy tắc nào có Prefix là "-" hoặc "All objects",
 *      hãy BẤM XÓA HOẶC SỬA NGAY để tránh tiếp tục bị xóa nhầm file hợp đồng!
 *    - THÊM HOẶC SỬA QUY TẮC:
 *      + Rule name: `auto-delete-ai-temp-24h`
 *      + Apply to: Chọn `Objects with a specific prefix` (BẮT BUỘC)
 *      + Prefix: Điền chính xác `ai-temp/` (BẮT BUỘC có dấu `/` ở cuối)
 *      + Action: `Delete uploaded objects` -> sau `1 day`
 * 5. Bấm `Save rule` để áp dụng.
 * 6. (Khuyến nghị an toàn): Bật `Object Versioning` trong tab Settings để có thể phục hồi tệp nếu lỡ bị xóa.
 */

console.log("=== CLOUDFLARE R2 LIFECYCLE GUIDE & SAFETY AUDIT ===");
console.log("1. Vào Cloudflare Dashboard -> R2 -> Bucket 'hrp-contract'");
console.log("2. Settings -> Object lifecycle rules");
console.log("3. CẢNH BÁO: Kiểm tra trường Prefix PHẢI LÀ 'ai-temp/'. TUYỆT ĐỐI KHÔNG ĐỂ TRỐNG!");
console.log("4. Nếu Prefix đang trống hoặc All objects: SỬA HOẶC XÓA NGAY LẬP TỨC.");
console.log("====================================================");
