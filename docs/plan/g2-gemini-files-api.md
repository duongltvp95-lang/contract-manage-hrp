# Kế hoạch G2 — Refactor AI extraction sang Gemini Files API

> **Mục đích**: Giảm latency + payload khi AI đọc hợp đồng, bằng cách thay `inlineData` base64 (flow hiện tại) bằng **Gemini Files API** (upload 1 lần, dùng `fileData.fileUri` nhiều lần, không gửi lại bytes).
>
> **Người viết**: T1 (Cursor Assistant) — đánh giá kỹ thuật 2026-10-17.
> **Trạng thái**: BẢN NHÁP — chờ T1/Owner duyệt rồi giao T2 coder chính thức trong round mới.
> **Phạm vi áp dụng**: `lib/ai/gemini.ts`, `app/api/ai/upload-url/route.ts`, `app/(app)/contracts/actions.ts`, `components/contracts/contract-form.tsx`, `tests/unit/ai-extract.test.ts`.

---

## 0. Tóm tắt 30 giây

- **Vấn đề**: AI đọc văn bản (hợp đồng PDF/ảnh) đang chậm vì gửi base64 inline (~33% phình) + 2 vòng network (browser→R2 rồi R2→Next→Gemini).
- **Giải pháp**: Upload file lên Gemini Files API 1 lần (`https://generativelanguage.googleapis.com/upload/v1beta/files`), nhận `fileUri` (vd `files/abc123`), gọi `generateContent` với `fileData.fileUri` — body chỉ còn prompt + URI (vài KB thay vì 26 MB cho file 20 MB).
- **Tác động ước tính**: Giảm **20–60% latency** cho file lớn; giảm **chi phí bandwidth** giữa Vercel và Gemini; giảm RAM serverless.
- **Trade-off**: File Gemini có TTL 48h → cần xoá sau khi extract (1 request DELETE); file tạm trên R2 vẫn cần (để re-extract/audit) — giữ nguyên lifecycle 24h.

---

## 1. Bối cảnh kỹ thuật

### 1.1 Flow hiện tại (4 chặng tuần tự — xem `docs/plan/g2-gemini-files-api.md` mục A.1 ở báo cáo 2026-10-17)

```
1. Client → POST /api/ai/upload-url                  (~300–500 ms)   tạo R2 presigned PUT
2. Client → PUT trực tiếp R2 (XHR, có progress)      (~3–8 s)        upload file lên R2
3. Server → getObjectBuffer() từ R2                   (~2–4 s)        tải file về Next
4. Server → POST Gemini generateContent {inlineData}   (~6–36 s)       3 model × 12s timeout
```

Tổng: **~12–45 giây** cho file 10–20 MB.

### 1.2 Hạn chế cốt lõi của flow hiện tại

- `inlineData` trong request body → base64 phình 33%; đẩy toàn bộ bytes qua HTTP.
- `extractContractFromBuffer` nhận `Buffer` → bắt buộc `transformToByteArray` từ R2, không thể stream.
- Round-trip R2 là **không cần thiết** về mặt kỹ thuật (file không bao giờ dùng lại trong Next — chỉ pass tới Gemini).

---

## 2. Flow sau G2 (mục tiêu)

```
1. Client → POST /api/ai/upload-url  (giữ nguyên, R2)  (~300–500 ms)
2. Client → PUT trực tiếp R2                          (~3–8 s)
3. Server → stream R2 → POST Gemini Files API          (~3–8 s)
            (multipart resumable upload, KHÔNG tải về Next)
4. Server → POST Gemini generateContent {fileData.fileUri} (~3–14 s)
            (1 model, body chỉ vài KB)
5. Server → DELETE Gemini file (cleanup)              (~200 ms)
6. Server → DELETE R2 object (best-effort, có rồi)     (~200 ms)
7. Server → parse JSON + match partner + return        (~300 ms)
```

Tổng ước tính: **~7–22 giây** (giảm 30–50% so với hiện tại).

### Tại sao giảm?

| Lý do | Giảm được |
|---|---|
| Bỏ `transformToByteArray` trên Next (không buffer toàn bộ file trong RAM) | ~2–4 s + RAM |
| `generateContent` body vài KB thay vì 26 MB | Giảm latency network, ít chunk |
| Tăng timeout `generateContent` từ 12s → 25s, fallback 3 → 2 model | Ổn định hơn |

---

## 3. Thiết kế chi tiết

### 3.1 Module mới: `lib/ai/gemini-files.ts`

```ts
import "server-only";

const UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const FILES_URL = "https://generativelanguage.googleapis.com/v1beta/files";

export type GeminiFile = {
  name: string;           // "files/abc123"
  uri: string;            // dùng trong fileData.fileUri
  mimeType: string;
  sizeBytes: number;
};

/**
 * Upload 1 file lên Gemini Files API qua multipart/resumable upload.
 * KHÔNG buffer toàn bộ vào RAM: dùng stream từ R2 response body.
 *
 * @param buffer Buffer của file
 * @param mimeType MIME type (đã normalize)
 * @param filename Tên gốc (chỉ log)
 * @param apiKey process.env.GEMINI_API_KEY
 */
export async function uploadToGeminiFiles({
  buffer,
  mimeType,
  filename,
  apiKey,
}: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  apiKey: string;
}): Promise<ServiceResult<GeminiFile>>;

export async function deleteGeminiFile(
  fileName: string,
  apiKey: string,
): Promise<void>;
```

**Lưu ý quan trọng**:
- Gemini Files API yêu cầu **multipart upload** với header `X-Goog-Upload-Protocol: multipart`. Body:
  ```
  --boundary
  Content-Type: application/json; charset=UTF-8

  {"file": {"display_name": "filename.pdf"}}

  --boundary
  Content-Type: application/pdf

  <bytes>
  --boundary--
  ```
- Body phải là multipart mới nhận bytes; KHÔNG dùng `inlineData` URI base64 ở đây.
- Reference: <https://ai.google.dev/api/files>

### 3.2 Sửa `lib/ai/gemini.ts`

**Public API mới** (thay vì `Buffer`):

```ts
export async function extractContractFromBufferOrFile({
  // 1 trong 2:
  buffer, mimeType, filename,
  // HOẶC:
  geminiFileName, geminiFileUri,
  apiKey, // truyền vào thay vì đọc process.env ở đây
}: {...}): Promise<ServiceResult<ExtractedContract>>;
```

**Logic thay đổi**:

```ts
// Trong vòng lặp model:
if (input.geminiFileName) {
  // Dùng fileData — body nhỏ
  requestBody.contents[0].parts[0] = {
    fileData: { mimeType, fileUri: input.geminiFileUri },
  };
} else {
  // Fallback cũ — inlineData base64 (giữ cho test/dev không có Files API)
  requestBody.contents[0].parts[0] = {
    inlineData: { mimeType, data: buffer.toString("base64") },
  };
}
```

### 3.3 Sửa `app/(app)/contracts/actions.ts`

```ts
export async function extractContractAction(formData: FormData): Promise<...> {
  // ... existing auth check ...

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return validationFailure("Chưa cấu hình GEMINI_API_KEY...", [...]);

  // Đường 1: < 1 MB — đi thẳng từ FormData, upload lên Files API
  // Đường 2: > 1 MB — đã có trên R2, stream lên Files API
  let geminiFile: GeminiFile | null = null;

  if (objectKey) {
    const downloaded = await getObjectBuffer(objectKey);
    await deleteObject(objectKey).catch(() => {});
    if (!downloaded) return validationFailure(...);

    const uploadRes = await uploadToGeminiFiles({
      buffer: downloaded,
      mimeType,
      filename,
      apiKey,
    });
    if (!uploadRes.ok) return fromService(uploadRes);
    geminiFile = uploadRes.data;
  } else {
    // Tương tự với FormData file
  }

  try {
    // Gọi extraction với file URI — body nhỏ
    const extractionResult = await extractContractFromBufferOrFile({
      geminiFileName: geminiFile.name,
      geminiFileUri: geminiFile.uri,
      mimeType,
      apiKey,
    });

    // ... existing matching logic ...

    return { ok: true, data: result };
  } finally {
    // Cleanup bắt buộc để không tốn quota Files
    if (geminiFile?.name) {
      await deleteGeminiFile(geminiFile.name, apiKey).catch((err) => {
        console.warn(`[ai:gemini] Không xoá được file tạm ${geminiFile.name}:`, err);
      });
    }
  }
}
```

### 3.4 KHÔNG cần sửa `components/contracts/contract-form.tsx`

Flow client giữ nguyên (upload R2 qua presigned URL) — chỉ phần server đổi.

---

## 4. Kế hoạch test

### 4.1 Unit test mới (`tests/unit/ai-extract.test.ts`)

Mock `global.fetch` và verify:

| Test | Input | Expected |
|---|---|---|
| `uploadToGeminiFiles gửi multipart đúng định dạng` | buffer 100 bytes + mime | `Content-Type: multipart/related; boundary=...`, body có JSON metadata + bytes |
| `deleteGeminiFile gọi đúng URL` | name="files/abc" | `DELETE files/abc?key=...` |
| `extractContractFromBufferOrFile dùng fileData khi có URI` | URI + mime | request body có `parts: [{fileData: {mimeType, fileUri}}]`, KHÔNG có `inlineData` |
| `extractContractFromBufferOrFile fallback inlineData khi không có URI` | buffer + mime | request body giống cũ (`inlineData` base64) |
| `extractContractFromBufferOrFile cleanup Gemini file trong finally` | URI + lỗi parse | `DELETE files/abc` được gọi dù extract fail |

### 4.2 Integration test (cần `GEMINI_API_KEY` thật)

**YÊU CẦU**: phải có key thật trong `.env.local`. Test trên CI bị skip tự động (giống các e2e test khác) bằng cách check `hasGeminiKey()` helper.

File mới: `tests/integration/ai-extract-gemini.test.ts`
- Setup: `GEMINI_API_KEY` SET → chạy; EMPTY → skip.
- Test: upload 1 file PDF mẫu (nhỏ, ~10 KB), đợi 10–30 s, verify trả về JSON hợp lệ, file được cleanup.
- Sweep: cleanup Gemini files cũ (> 1 giờ) sau suite.

### 4.3 Gate cuối cùng

```
pnpm typecheck
pnpm lint
pnpm build                      ← phải pass (kiểm tra import + maxDuration)
pnpm test --run                 ← unit, bao gồm test mới
pnpm test:integration           ← cần secrets thật
pnpm test:e2e                   ← giữ nguyên specs cho contract-form-extract
```

---

## 5. Migration & rollout

### 5.1 Không cần migration DB

### 5.2 Vercel env

| Biến | Trạng thái cần | Ghi chú |
|---|---|---|
| `GEMINI_API_KEY` | SET | Đã có sẵn (theo commit `ab8ff91`) |

### 5.3 Rollback strategy

Nếu G2 fail trên production:
- **Bước 1**: Revert 1 commit (giữ nguyên commit `ab8ff91` + các commit khác).
- **Bước 2**: Flow cũ (`inlineData` base64) vẫn còn là fallback trong `extractContractFromBufferOrFile` nếu không có `geminiFileName`.

---

## 6. Risks & gotchas

| # | Rủi ro | Xác suất | Tác động | Giảm thiểu |
|---|---|---|---|---|
| R1 | Gemini Files API quota/cost khác inline | Thấp | Phải trả thêm ~$0.001/file | Track usage trên Vercel logs |
| R2 | Multipart upload fail (network blip) → cần retry | Trung bình | User phải bấm lại | Thêm `AbortSignal.timeout(30_000)` + 1 retry |
| R3 | File Gemini không xoá được (cleanup fail) | Thấp | Tốn quota 48h | Log warn + cron `scripts/cleanup-gemini-temp.ts` |
| R4 | File > 20 MB bị reject (giống inline) | Thấp | Edge case hiếm | Thông báo tiếng Việt: "File quá lớn (>20 MB)" |
| R5 | MIME detection sai (vd PDF là ảnh scan) | Trung bình | AI không đọc được | `resolveMimeType` đã có; tin tưởng |

---

## 7. Checklist cho T2 (khi vào round chính thức)

- [ ] Đọc file này + `docs/REVIEW-2026-10-11.md` + `.cursor/rules/agent-working-rules.mdc`
- [ ] Verify `GEMINI_API_KEY` SET trong `.env.local` (chỉ in tên + SET/EMPTY, KHÔNG in giá trị)
- [ ] Tạo module `lib/ai/gemini-files.ts`
- [ ] Refactor `lib/ai/gemini.ts` theo mục 3.2
- [ ] Refactor `extractContractAction` theo mục 3.3
- [ ] Viết unit test theo mục 4.1
- [ ] Viết integration test theo mục 4.2 (nếu có key thật, skip nếu không)
- [ ] Chạy gate mục 4.3
- [ ] Báo cáo 5 mục
- [ ] **KHÔNG push** — đợi Owner duyệt

---

## 8. Ước lượng effort

| Task | Thời gian |
|---|---|
| Tạo `lib/ai/gemini-files.ts` | 1 giờ |
| Refactor `lib/ai/gemini.ts` | 1 giờ |
| Refactor `extractContractAction` | 30 phút |
| Unit test (5 test cases) | 1 giờ |
| Integration test (1 spec) | 30 phút |
| Verify gate (typecheck/lint/build/test) | 30 phút |
| Code review + sửa | 30 phút |
| **Tổng** | **~5 giờ** |

→ Phù hợp với 1 round chính thức (1 task lớn), không nên làm "tweaks trong commit lẻ".

---

## 9. Tài liệu tham khảo

- Gemini Files API docs: <https://ai.google.dev/api/files>
- Gemini Files API upload (multipart): <https://ai.google.dev/api/files#file uploads>
- Review kỹ thuật 2026-10-11: `docs/REVIEW-2026-10-11.md` §6.1 (nợ 6 task đã done)
- Báo cáo 2026-10-17 của T1 (file này viết kèm): §A.1–A.3

---

> **Ghi chú cuối**: Kế hoạch này do T1 viết sau khi đánh giá code. **T2 KHÔNG TỰ Ý thay đổi kiến trúc đã chốt ở §3** khi implement; nếu cần đổi, báo T1 kèm bằng chứng (theo rule §4).
