# Trạng thái luồng AI đọc hợp đồng

Cập nhật: 2026-10-21. Tài liệu này thay thế các ước lượng, giới hạn và checklist cũ phía dưới của bản G2 v2 trước đây.

## Luồng hiện tại

1. Client kiểm tra giới hạn 50 MB. Tệp lớn hơn 2 MB được tải lên R2; tệp nhỏ hơn hoặc bằng 2 MB đi qua Server Action. Client và server chia sẻ một `traceId`; thời gian upload R2 phía client được ghi cùng trace.
2. Server xác thực người dùng, giới hạn trích xuất AI ở 10 yêu cầu mỗi phút cho mỗi người dùng, kiểm tra MIME và kích thước thực tế.
3. Tệp từ 2 MB trở lên được upload lên Gemini Files API. Tệp nhỏ hơn 2 MB dùng `inlineData`; PDF có lớp text thử parse cục bộ tối đa 1,5 giây, 10 trang và 12.000 ký tự trước khi gọi model. PDF đi qua Files API bỏ qua parse cục bộ vì model đã nhận tệp gốc.
4. Gemini thử tối đa 2 model, mỗi lượt tối đa 15 giây trong ngân sách Server Action 48 giây; JSON đầu ra bị giới hạn ở 2.048 token. PDF scan hoặc PDF không có text layer vẫn được gửi dưới dạng tài liệu gốc.
5. Các tra cứu đối tác, công ty, trùng lặp và hợp đồng gốc chạy song song, có timeout giới hạn. Kết quả AI chỉ đề xuất đối tác; người dùng phải chọn đối tác có sẵn hoặc xác nhận tạo mới từ form.
6. Tệp tạm trên R2 và Gemini được dọn sau phản hồi bằng `after()`. Nếu người dùng dừng xử lý nhiều tệp, tệp đang chạy được hoàn tất và không bắt đầu tệp tiếp theo.

## Quan sát độ trễ

Log server dùng chung `traceId` và có các stage `rate_limit`, `r2_head`, `r2_download`, `gemini_files_upload`, `gemini_extract`, `db_enrichment`, cùng tổng thời gian action. Client ghi thời gian tổng và upload R2. Log không ghi tên tệp, nội dung hợp đồng, hay API key.

Để tìm bottleneck, lọc theo `traceId` rồi so sánh `elapsedMs` từng stage. Nếu thời gian `gemini_extract` cao, log nêu model, mã HTTP, lượt fallback và thời gian từng lượt. Nếu `r2_download` cao, đối chiếu kích thước tệp và upload R2 ở client.

## Giới hạn và vận hành

- Giới hạn hiện tại là 50 MB; tệp lớn được chuyển qua R2 và Gemini Files API.
- PDF text-only bị cắt ở 10 trang/12.000 ký tự và có thông báo truncation; PDF scan tiếp tục qua model với tệp gốc.
- Dừng batch chỉ có hiệu lực sau tệp đang xử lý vì request Gemini hiện không có cơ chế hủy an toàn.
- Áp dụng migration `20261026000000_add_ai_extraction_rate_limit.sql` trên từng database trước khi phát hành; nếu RPC chưa được cập nhật, AI sẽ fail closed và không chạy extraction.
- Chưa có benchmark với Gemini thật trong tài liệu này. Để xác nhận cải thiện thực tế, cần so sánh p50/p95 theo stage trên production telemetry sau triển khai. Chưa chạy unit, integration, lint, typecheck hoặc build trong lần sửa này.

## Việc còn lại

- Thu thập telemetry đủ để đặt ngưỡng p50/p95 và phát hiện model/region có độ trễ cao.
- Thêm kiểm thử có mock cho rate limit, timeout PDF, cleanup bất đồng bộ và dừng batch; thêm benchmark Gemini thật riêng trong môi trường có credential.
- Tách các module AI và server actions lớn thành các phần nhỏ hơn sau khi có regression coverage để giảm rủi ro refactor.
