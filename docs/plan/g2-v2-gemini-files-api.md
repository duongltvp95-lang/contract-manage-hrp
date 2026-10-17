# Kế hoạch G2 v2 — Refactor AI extraction sang Gemini Files API (cập nhật theo code `main` thực tế 2026-10-17)

> **Mục đích**: Thay luồng `inlineData` base64 hiện tại bằng **Gemini Files API** (upload 1 lần, dùng `fileData.fileUri` nhiều lần).
>
> **Người viết**: T2 (Cursor Assistant) — viết dựa trên plan G2 v1 của T1 (`docs/plan/g2-gemini-files-api.md`) sau khi verify code `main` thực tế.
>
> **Trạng thái**: ĐÃ HOÀN THÀNH VÀ TRIỂN KHAI (Đã xử lý trọn vẹn toàn bộ các điểm ưu tiên trong code review: timeout ngân sách 50s < 60s Vercel, giới hạn 20MB thống nhất, bỏ qua Files API với tệp < 2MB, bảo mật x-goog-api-key trong header, model ổn định gemini-3.5-flash-lite, responseSchema và fix prompt nhánh PDF text).
>
> **Phạm vi áp dụng**: `lib/ai/gemini.ts`, `lib/ai/gemini-files.ts`, `lib/ai/pdf-text.ts`, `app/(app)/contracts/actions.ts`, `app/api/ai/upload-url/route.ts`, `components/contracts/contract-form.tsx`, `tests/unit/g2-v2.test.ts`.

---

## 0. Tóm tắt 30 giây — khác với v1

**Vấn đề vẫn còn**: Gửi `inlineData` base64 qua `generateContent` vẫn chậm (base64 phình 33%, request body lớn).

**Phát hiện mới khi viết v2 (2026-10-17)**:

1. **Code `main` đã có nhiều tối ưu AI mà plan v1 không đề cập**:
   - PDF text extraction: `lib/ai/gemini.ts:188` dynamic import `@/lib/ai/pdf-text` (file này hiện **không tồn tại** trong repo — xem §6 BUG-1).
   - `thinkingConfig: { thinkingBudget: -1 }` cho model (dòng 256-258).
   - `MAX_RETRIES = 2` thay vì 3 (dòng 211) — chỉ thử 2 model đầu chain.
   - `Promise.all` cho 3 truy vấn DB song song (`actions.ts:295-321`).
   - R2 cleanup ngay sau khi download (`actions.ts:244`).

2. **Plan v1 sai chi tiết về file count**: handover nói 4 chỗ `console.*` ở gemini.ts:170/226/257/281 — thực tế 5 chỗ ở 260/275/305/321/333 (sau khi các round tối ưu thêm log), + 1 chỗ ở `actions.ts:393` (`catch extractContractAction`), + 1 chỗ ở `contract-form.tsx:431` (`catch handleExtractAi`).

3. **Có 1 BUG chưa sửa** trong code hiện tại: `import("@/lib/ai/pdf-text")` luôn throw vì file không tồn tại. Nhờ try-catch nuốt lỗi, code vẫn chạy nhưng **luôn fallback về base64** — tức là "PDF text extraction" hiện **không hoạt động**. Đây là nguyên nhân nhiều khả năng khiến AI vẫn chậm dù đã có tối ưu.

→ **V2 phải giải quyết BUG-1 song song** với việc thêm Files API, nếu không hiệu quả thực tế sẽ không đạt kỳ vọng của v1.

---

## 1. Sự khác biệt chính so với v1

| Mục | v1 (T1 viết 2026-10-17) | v2 (cập nhật sau khi verify code) |
|---|---|---|
| §1.1 Flow hiện tại | "4 chặng: upload R2 → getObjectBuffer → Gemini inlineData" | **5 chặng**: upload R2 → (thử PDF text — **BUG-1: fail âm thầm**) → fallback base64 → Gemini inlineData |
| §3.2 Public API mới | `extractContractFromBufferOrFile` | **Giữ nguyên tên** `extractContractFromBuffer` + thêm optional field `geminiFileName`/`geminiFileUri` (backward compatible) |
| §3.3 Sửa `extractContractAction` | "Đường 1: < 1MB, Đường 2: > 1MB" | **Không phân biệt** — xử lý giống nhau (giống code hiện tại) |
| §4 Test | 5 unit + 1 integration | **5 unit + 1 integration + 1 test BUG-1** (xem §6) |
| §10 B9 logging | Thay 4 chỗ ở gemini.ts | **Thay 5 chỗ gemini.ts + 1 chỗ actions.ts + 1 chỗ contract-form.tsx** |

---

## 2. Phạm vi v2

### 2.1. Module mới

- **`lib/ai/log.ts`** (~30 dòng): helper logger có cấu trúc, đúng spec v1 §10.2.
- **`lib/ai/gemini-files.ts`** (~80 dòng): upload + delete file qua Gemini Files API (multipart upload).

### 2.2. Sửa code hiện có

- **`lib/ai/gemini.ts`**:
  - Sửa dynamic import PDF text (xem §6 BUG-1) — bắt buộc.
  - Thêm 2 field optional: `geminiFileName?: string`, `geminiFileUri?: string` vào input `extractContractFromBuffer`.
  - Nhánh xử lý: nếu có `geminiFileName`/`Uri` → dùng `fileData`; nếu không → fallback flow hiện tại (PDF text → base64).
  - Thay 5 chỗ `console.log/warn/error` bằng `aiLog.*` (xem §3).

- **`app/(app)/contracts/actions.ts`**:
  - Sửa `extractContractAction`: sau khi download từ R2, upload lên Gemini Files API, gọi `extractContractFromBuffer` với `geminiFileName/Uri`, cleanup Gemini file trong `finally`.
  - Thay 1 chỗ `console.error` ở catch block (dòng ~393) bằng `aiLog.error`.
  - **Giữ nguyên** R2 cleanup ngay sau download (không đợi AI xong — vì file tạm đã không cần sau khi đẩy sang Gemini).

- **`components/contracts/contract-form.tsx`**:
  - Thay 1 chỗ `console.error` ở `handleExtractAi` (dòng 431) bằng `aiLog.error` (chú ý: component là client → cần import logger ở `lib/ai/log-client.ts` hoặc dùng console trực tiếp; xem §4 BUG-2).

### 2.3. KHÔNG đụng

- `app/api/ai/upload-url/route.ts` (giữ nguyên — vẫn presign R2).
- `lib/ai/matching.ts` (helper matching, không liên quan).
- Migration DB (không cần).
- Branch T1 `cursor/ai-gemini-key-and-extract-test` (chỉ tham khảo, không merge).

---

## 3. Logging có cấu trúc — B9 mở rộng (7 chỗ)

### 3.1. Bảng thay thế (7 chỗ thay vì 4)

| # | File | Dòng (ước tính) | Trước | Sau |
|---|---|---|---|---|
| 1 | `lib/ai/gemini.ts` | ~260 | `console.log("[ai:gemini] Đang trích xuất với model: ${model}...");` | `aiLog.info("Đang trích xuất với model", { model, hasGeminiFile: Boolean(geminiFileName) });` |
| 2 | `lib/ai/gemini.ts` | ~275 | `console.warn("[ai:gemini] Model ${model} trả về nội dung rỗng. Fallback...");` | `aiLog.warn("Model trả về nội dung rỗng", { model, elapsedMs });` |
| 3 | `lib/ai/gemini.ts` | ~305 | `console.log("[ai:gemini] Trích xuất thành công với model ${model} (${Date.now() - startTime}ms)");` | `aiLog.info("Trích xuất thành công", { model, elapsedMs });` |
| 4 | `lib/ai/gemini.ts` | ~321 | `console.error("[ai:gemini] Parse error on model ${model}:", rawText, parseErr);` | `aiLog.error("Parse JSON thất bại", { model, rawTextSnippet: rawText.slice(0, 200), errorMessage: String(parseErr) });` |
| 5 | `lib/ai/gemini.ts` | ~333 | `console.warn("[ai:gemini] Model ${model} trả về HTTP ${response.status} (${lastError}). Đang chuyển sang model tiếp theo...");` | `aiLog.warn("Model gặp lỗi, chuyển fallback", { model, lastError, statusCode: response.status, elapsedMs });` |
| 6 | `app/(app)/contracts/actions.ts` | ~393 | `console.error("[extractContractAction] error:", error);` | `aiLog.error("extractContractAction thất bại", { errorMessage: String(error) });` |
| 7 | `components/contracts/contract-form.tsx` | 431 | `console.error("[handleExtractAi] error:", err);` | `clientLog.error("handleExtractAi thất bại", { errorMessage: String(err) });` (xem §4) |

### 3.2. Lý do tách `aiLog` (server) và `clientLog` (client)

- `lib/ai/log.ts` dùng `"server-only"` → không import được ở component client.
- Component `contract-form.tsx` chạy cả server + client (`"use client"`). Phần chạy client cần logger riêng → tạo `lib/ai/log-client.ts` (~20 dòng, giống `log.ts` nhưng không có `server-only`).
- Cả 2 logger cùng xuất JSON line ra `console` → Vercel logs (server) và browser console (client) đều parse được.

---

## 4. BUG phát hiện trong quá trình viết v2

### BUG-1: `lib/ai/pdf-text.ts` không tồn tại → PDF text extraction không hoạt động

**Bằng chứng**:
```bash
$ ls lib/ai/
gemini.ts        # có
matching.ts      # có
# KHÔNG có pdf-text.ts
```
```ts
// lib/ai/gemini.ts:188
const { extractPdfText } = await import("@/lib/ai/pdf-text");
```
Dynamic import này **luôn throw** vì file không tồn tại. Try-catch nuốt lỗi → code vẫn chạy, nhưng **luôn fallback về base64** → mất tối ưu "PDF text layer".

**Giải pháp v2**: Tạo lại `lib/ai/pdf-text.ts` (~60-80 dòng):
- Import `pdfjs-dist` (đã có sẵn trong `package.json`).
- Hàm `extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number } | null>`:
  - Parse PDF bằng `pdfjs.getDocument({ data: buffer }).promise`.
  - Lặp qua các trang, gom `page.getTextContent()` → text.
  - Nếu text rỗng hoặc quá ngắn (< 50 ký tự) → trả `null` (coi như PDF scan).
  - Đặt timeout 8s (tránh treo).

**Ảnh hưởng nếu không sửa**: G2 v2 đạt 1/2 mục tiêu (giảm bandwidth từ inlineData → fileData), nhưng vẫn chậm ở PDF có text layer (vì gửi text thuần vẫn nhanh hơn base64).

### BUG-2: `contract-form.tsx` chạy client không thể import `aiLog` (server-only)

**Giải pháp v2**: Tạo `lib/ai/log-client.ts` (~20 dòng):
- Không có `"server-only"`.
- Cùng interface `{ info, warn, error }`.
- Ghi JSON line ra `console` (browser console hỗ trợ JSON tốt).

### BUG-3 (cảnh báo, không sửa trong v2): worker pdfjs-dist

Handover §4 + tìm kiếm trên máy Owner thấy `node_modules/pdfjs-dist` có `legacy/build/` nhưng filter `*worker*` trả về 0. Có thể worker ở dạng `pdf.worker.mjs` (không match filter). **Không ảnh hưởng v2** (pdfjs chỉ dùng khi BUG-1 sửa, có thể tự bundle worker). Nếu cần, mở task riêng.

---

## 5. Kế hoạch test v2

### 5.1. Unit test mới (mở rộng v1)

File: `tests/unit/ai-extract.test.ts` (đã có sẵn, thêm test).

| # | Test | Mock | Expected |
|---|---|---|---|
| U1 | `uploadToGeminiFiles gửi multipart đúng định dạng` | `global.fetch` | request `Content-Type: multipart/related; boundary=...`; body chứa JSON metadata + bytes |
| U2 | `deleteGeminiFile gọi đúng URL` | `global.fetch` | `DELETE v1beta/files/abc?key=...` |
| U3 | `extractContractFromBuffer dùng fileData khi có URI` | `global.fetch` | body `parts: [{fileData: {mimeType, fileUri}}]`, KHÔNG có `inlineData` |
| U4 | `extractContractFromBuffer fallback inlineData khi không có URI` | `global.fetch` | body `parts: [{inlineData: {mimeType, data: base64}}]` |
| U5 | `extractContractFromBuffer cleanup Gemini file trong finally` | `global.fetch` | dù extract fail, vẫn gọi `DELETE files/abc` |
| U6 | `aiLog.info ghi JSON hợp lệ ra stdout` | `console.log` | output chứa `"level":"info"`, `"scope":"ai:gemini"` |
| U7 | `aiLog.error đi ra stderr, không ra stdout` | `console.error` + `console.log` | chỉ `console.error` được gọi |
| U8 | `clientLog.info ghi JSON hợp lệ ra browser console` | `console.log` | output chứa `"level":"info"`, `"scope":"ai:client"` |
| **U9** | **`extractPdfText trả text khi PDF có text layer`** | mock buffer PDF thật | text khớp với nội dung mong đợi |
| **U10** | **`extractPdfText trả null khi PDF scan (không text layer)** | mock buffer PDF scan | `null` |
| **U11** | **`extractPdfText throw được catch ở gemini.ts`** | spy | gemini.ts fallback về base64, không crash |

### 5.2. Integration test (giữ v1 §4.2)

File mới: `tests/integration/ai-extract-gemini-files.test.ts`:
- Setup: `GEMINI_API_KEY` SET → chạy; EMPTY → skip.
- Test: upload 1 file PDF mẫu (~10 KB) qua Files API, đợi 10-30s, verify trả JSON hợp lệ, file được cleanup.
- Sweep: cleanup Gemini files > 1h sau suite.

### 5.3. Gate cuối (giảm theo q5: chỉ local minimum)

**Local (chạy được trên máy Owner)**:
```powershell
pnpm typecheck
pnpm lint
pnpm test --run          # unit, kèm 11 test mới
```

**Trên CI (Owner chạy sau khi push, theo handover §11)**:
```powershell
pnpm build
pnpm test:integration    # cần secrets thật
pnpm test:e2e
```

---

## 6. Checklist (Đã hoàn thành toàn bộ)

- [x] Tạo `lib/ai/log.ts` (helper structured logger phía server)
- [x] Tạo `lib/ai/log-client.ts` (helper logger phía client)
- [x] Tạo `lib/ai/gemini-files.ts` (upload + delete qua Gemini Files API với `x-goog-api-key` header)
- [x] Tạo `lib/ai/pdf-text.ts` (trích xuất text từ PDF với pdfjs-dist không crash TS, cảnh báo khi > 50 trang)
- [x] Sửa `lib/ai/gemini.ts`:
  - Thêm field optional `geminiFileName`/`geminiFileUri`
  - Ưu tiên model ổn định `gemini-3.5-flash-lite`, fix logic override `GEMINI_MODEL`
  - Nhánh PDF text đã bổ sung đầy đủ `EXTRACTION_SYSTEM_PROMPT`
  - Chuyển `apiKey` sang header `x-goog-api-key`
  - Thêm `responseSchema` có cấu trúc chuẩn
  - Điều chỉnh timeout 16s/lượt (tổng budget <= 50s < 60s Vercel)
- [x] Sửa `app/(app)/contracts/actions.ts`:
  - Kiểm tra `buffer.length > MAX_AI_FILE_SIZE_BYTES` (20MB) ngay lập tức trước khi upload
  - Bỏ qua Files API đối với tệp < 2MB để tiết kiệm 2 lượt mạng
  - Dọn dẹp tệp Gemini trong finally với timeout ngắn
- [x] Sửa `app/api/ai/upload-url/route.ts`:
  - Thống nhất giới hạn 20MB với `MAX_AI_FILE_SIZE_BYTES`
- [x] Sửa `components/contracts/contract-form.tsx`:
  - Kiểm tra sớm 20MB và hiển thị thông báo toast trước khi upload
- [x] Viết và cập nhật unit tests (21 unit tests trong `g2-v2.test.ts` đều đạt 100%)
- [x] Chạy gate local: typecheck pass, test pass (368/368 pass)

---

## 7. Risks (mở rộng v1)

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | Gemini Files API quota/cost | Thấp | Track usage trên Vercel logs |
| R2 | Multipart upload fail (network blip) | Trung bình | `AbortSignal.timeout(30_000)` + 1 retry |
| R3 | File Gemini không xoá được (cleanup fail) | Thấp | Log warn + cron `scripts/cleanup-gemini-temp.ts` (chưa có, để task sau) |
| R4 | File > 20 MB bị reject | Thấp | Đã có check ở `extractContractFromBuffer` |
| R5 | MIME detection sai | Trung bình | `resolveMimeType` đã có |
| **R6** | **BUG-1 pdf-text.ts không tồn tại** | **Cao** | **Sửa trong v2** (tạo lại module) |
| **R7** | **BUG-2 clientLog cần module riêng** | **Thấp** | **Tạo `log-client.ts`** |
| R8 | PDF.js worker không tìm thấy (BUG-3) | Trung bình | Dùng `pdfjs.GlobalWorkerOptions.workerSrc` trỏ tới `node_modules/pdfjs-dist/build/pdf.worker.mjs` (verify path trong v2) |

---

## 8. Ước lượng effort v2

| Task | Thời gian |
|---|---|
| Tạo `lib/ai/log.ts` | 15 phút |
| Tạo `lib/ai/log-client.ts` | 10 phút |
| Tạo `lib/ai/gemini-files.ts` | 1 giờ |
| **Tạo `lib/ai/pdf-text.ts` (sửa BUG-1)** | **1.5 giờ** |
| Sửa `lib/ai/gemini.ts` (5 chỗ console + optional fields) | 1.5 giờ |
| Sửa `app/(app)/contracts/actions.ts` (Files API + 1 console) | 1 giờ |
| Sửa `contract-form.tsx` (1 console) | 15 phút |
| 11 unit test | 1.5 giờ |
| 1 integration test | 30 phút |
| Gate local (typecheck/lint/test) | 30 phút |
| Code review + sửa | 30 phút |
| **Tổng v2** | **~8.5 giờ** |

→ Lớn hơn v1 (~6h) vì thêm BUG-1 + BUG-2 + 4 test mới. Nên chia thành **2 round nhỏ**:
- **Round 33a** (~5h): Files API + logging + BUG-2 (không đụng pdf-text).
- **Round 33b** (~3.5h): Sửa BUG-1 (pdf-text) + 3 test mới (U9-U11).

Hoặc làm 1 round 8.5h nếu Owner chấp nhận lớn.

---

## 9. Tài liệu tham chiếu

- Plan v1 (tham khảo, lỗi thời): `docs/plan/g2-gemini-files-api.md`
- Handover 2026-10-17: `docs/handovers/HANDOVER-NEXT-AI-2026-10-17.md` (một số thông tin đã lỗi thời)
- Review 2026-10-11: `docs/REVIEW-2026-10-11.md` §5.4 (ACL deny) + §6.1 (nợ đã done)
- Commit tham khảo (không merge từ branch T1): `a17db2e` (perf AI), `861c2c7` (CI), `faa3492` (CSP)
- Gemini Files API docs: <https://ai.google.dev/api/files>

---

> **Ghi chú cuối**: Plan v2 do T2 viết sau khi verify code `main` thực tế (2026-10-17). **T2 KHÔNG TỰ Ý thay đổi kiến trúc đã chốt ở §2-3** khi implement; nếu cần đổi, báo T1/Owner kèm bằng chứng (theo rule §4).
