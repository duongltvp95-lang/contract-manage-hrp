# KẾ HOẠCH — Round 34: Tối ưu Gemini AI Extraction

**Ngày:** 2026-10-17
**T1:** đánh giá + viết kế hoạch
**T2:** (chưa giao)
**Branch:** `feat/ai-optimize-gemini`

---

## 1. MỤC TIÊU

Tối ưu hiệu năng AI extraction để **giảm thời gian chờ nhận diện hợp đồng** cho người dùng, tập trung vào 2 điểm:

1. **Giảm thời gian chờ Gemini**: model nhanh hơn + suy luận tối thiểu + giới hạn retry khi timeout.
2. **Giảm thời gian sau khi AI đọc xong**: chạy song song các truy vấn độc lập.

**Không đổi luồng nghiệp vụ** (form UX, trích xuất thông tin, tạo đối tác tự động, kiểm tra trùng lặp).

---

## 2. PHÂN TÍCH HIỆN TRẠNG

### 2.1 Vấn đề về model

`getGeminiModels()` trả về (thứ tự hiện tại):
1. `gemini-3-flash-preview` ← model **preview**, có thể 404 hoặc không ổn định
2. `gemini-3.5-flash-lite` ← model mới, nhanh, rẻ, ổn định
3. `gemini-flash-lite-latest` ← fallback cuối

**Logic hiện tại có bug**: nếu Owner set `GEMINI_MODEL=gemini-3.5-flash-lite`, nó nằm trong defaults nên **bị bỏ qua**, và code vẫn trả về đúng danh sách trên — không ưu tiên model đã cấu hình.

### 2.2 Vấn đề về suy luận

Gemini 3.x có thể suy luận nội bộ trước khi trả lời (extended thinking), làm tăng thời gian phản hồi đáng kể. API hỗ trợ `thinkingConfig.thinkingBudget` để giới hạn.

### 2.3 Vấn đề về retry

Code hiện thử tối đa 3 model × 12s = 36s overhead. Nếu mạng chậm hoặc model đầu bị quá tải, user phải chờ rất lâu.

### 2.4 Vấn đề về truy vấn song song

Trong `extractContractAction` (dòng ~300–370), 3 truy vấn sau chạy **tuần tự**:

```ts
// Dòng 298: chờ xong
const partnersRes = await searchPartners(searchTerm);

// Dòng 303: chờ xong
const companiesRes = await listCompanies({ organizationId });

// Dòng 366: chờ xong
const duplicate = await findDuplicateContract({ ... });
```

→ Nếu mỗi truy vấn Supabase mất 100–200ms, tổng thời gian chờ thêm **300–600ms** sau khi AI xong.

---

## 3. THAY ĐỔI CỤ THỂ

### 3.1 Sửa `getGeminiModels()` — ưu tiên model đã cấu hình

```ts
// BEFORE (dòng 10–18)
function getGeminiModels(): string[] {
  const envModel = process.env.GEMINI_MODEL?.trim();
  const defaults = [
    "gemini-3-flash-preview",
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
  ];
  if (envModel && !defaults.includes(envModel)) {
    return [envModel, ...defaults];
  }
  return defaults; // BUG: envModel nằm trong defaults → bị bỏ qua
}

// AFTER
function getGeminiModels(): string[] {
  const envModel = process.env.GEMINI_MODEL?.trim();

  // Mặc định: ưu tiên model nhanh/rẻ/ổn định trước
  // gemini-3.5-flash-lite: model mới, latency thấp, phù hợp extraction đơn giản
  // gemini-flash-lite-latest: fallback rẻ nhất
  // gemini-3-flash-preview: preview cuối cùng, có thể không ổn định → cuối cùng
  const orderedDefaults = [
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3-flash-preview",
  ];

  if (envModel) {
    // Ưu tiên tuyệt đối model đã cấu hình trong .env.local
    // Loại bỏ khỏi defaults để tránh thử trùng lặp
    const filtered = orderedDefaults.filter((m) => m !== envModel);
    return [envModel, ...filtered];
  }
  return orderedDefaults;
}
```

**Thay đổi:**
- Thứ tự defaults: `gemini-3.5-flash-lite` lên đầu.
- Logic ưu tiên: nếu `GEMINI_MODEL` được set → cho lên đầu và loại khỏi defaults.
- Owner muốn `gemini-3.5-flash-lite` làm mặc định → đặt nó lên đầu.

### 3.2 Thêm `thinkingConfig` — suy luận tối thiểu

Trong `generationConfig` (dòng ~200), thêm:

```ts
generationConfig: {
  responseMimeType: "application/json",
  temperature: 0.1,
  // Giới hạn suy luận nội bộ của model → giảm thời gian phản hồi
  // -1 = dùng default của model (thường là minimal cho flash-lite)
  // 0 = không suy luận (có thể ảnh hưởng chất lượng)
  thinkingConfig: {
    thinkingBudget: -1, // Sử dụng budget mặc định của model
  },
},
```

**Lưu ý:** `thinkingConfig` chỉ có trên Gemini 3.x models. Nếu API trả lỗi 400 với model cũ hơn, code sẽ fallback tự nhiên (không cần catch riêng).

### 3.3 Giới hạn số lần retry khi timeout

```ts
// BEFORE (dòng 179)
const models = getGeminiModels(); // 3 model
const PER_MODEL_TIMEOUT_MS = 12_000;
// Loop tất cả 3 model

// AFTER
const MODELS = getGeminiModels();
const PER_MODEL_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2; // Tổng: primary + 1 fallback = 2 model
// → Giảm từ 3×12s = 36s xuống còn 2×12s = 24s overhead tối đa
// Nếu model 1 timeout → thử model 2 → fail → trả lỗi user
```

```ts
// Trong loop:
// eslint-disable-next-line no-loop-func
for (const model of MODELS.slice(0, MAX_RETRIES)) {
  // ... existing code
}
```

**Quy tắc retry:**
- **Quá tải (503/429)**: fallback sang model tiếp theo (không đếm vào retry limit)
- **Timeout**: đếm 1 retry → nếu đã thử đủ 2 model → trả lỗi
- **404 model không tồn tại**: coi như timeout, fallback
- **400/401 lỗi logic**: **KHÔNG retry** → trả lỗi ngay

### 3.4 Song song hoá truy vấn độc lập

Trong `extractContractAction` (`app/(app)/contracts/actions.ts` dòng ~298–370):

```ts
// BEFORE (tuần tự)
const partnersRes = await searchPartners(searchTerm);
if ((!partnersRes.ok || partnersRes.data.length === 0) && searchTerm !== "") {
  partnersRes = await searchPartners("");
}
const companiesRes = await listCompanies({ organizationId: access.user.organizationId });
// ...
const duplicate = extracted.contractNumber
  ? await findDuplicateContract({ ... })
  : null;

// AFTER (song song)
const [partnersResult, companiesResult, duplicateResult] = await Promise.all([
  (async () => {
    let res = await searchPartners(searchTerm);
    if ((!res.ok || res.data.length === 0) && searchTerm !== "") {
      res = await searchPartners("");
    }
    return res;
  })(),
  listCompanies({ organizationId: access.user.organizationId }),
  extracted.contractNumber
    ? findDuplicateContract({
        contractNumber: extracted.contractNumber,
        signedDate: extracted.signedDate,
        expiryDate: extracted.expiryDate,
        organizationId: access.user.organizationId,
      })
    : Promise.resolve(null),
]);

const partners = partnersResult.ok ? partnersResult.data : [];
const companies = companiesResult.ok ? companiesResult.data : [];
const duplicate = duplicateResult;
```

**Đánh giá:** Supabase queries mất ~100–200ms mỗi cái → tuần tự = 300–600ms, song song = ~200ms (tối đa). Tiết kiệm **100–400ms** cho mỗi lần extract.

---

## 4. ESTIMATED IMPACT

| Thay đổi | Tiết kiệm ước tính |
|---|---|
| Model `gemini-3.5-flash-lite` thay vì preview | **20–40%** thời gian phản hồi (model nhanh hơn + ít extended thinking) |
| `thinkingConfig: thinkingBudget: -1` | **10–20%** (giảm suy luận nội bộ không cần thiết) |
| Giới hạn 2 model thay vì 3 | **12s** overhead tối đa (nếu cả 2 đều timeout → lỗi ngay) |
| Song song hoá 3 Supabase queries | **100–400ms** |
| **Tổng** | **1.5–3s** giảm trên tổng thời gian chờ user |

---

## 5. FILES CẦN THAY ĐỔI

| File | Mục thay đổi |
|---|---|
| `lib/ai/gemini.ts` | §3.1 + §3.2 + §3.3 + §3.5 |
| `app/(app)/contracts/actions.ts` | §3.4 |

**Không thay đổi:**
- UI / form (`contract-form.tsx`)
- Schema (`@schemas/contract.ts`)
- Services (`contracts.ts`, `partners.ts`)
- Integration test (không cần sửa — logic giống nhau)
- Unit test (nếu có mock `getGeminiModels` → cần cập nhật)

---

## 3.5 Trích văn bản từ PDF dạng văn bản (không phải scan) — §3.5 R34

### 3.5.1 Vấn đề

Gemini phải xử lý **toàn bộ nội dung thị giác** của PDF (cả text-layer PDFs lẫn scanned-image PDFs) qua `inlineData`. Với các hợp đồng dạng văn bản (không phải scan), model phải nhận diện text qua OCR nội bộ → **lãng phí** và **chậm hơn** so với gửi trực tiếp văn bản đã có.

### 3.5.2 Giải pháp

Thêm bước tiền xử lý: **dùng PDF.js kiểm tra xem PDF có lớp văn bản chọn được không**.

- **Có text layer**: trích văn bản → gửi cho Gemini dưới dạng text (thay vì base64 image/PDF).
- **Không có text layer (scanned)**: dùng luồng hiện tại (base64 PDF/image).

**Ước tính**: với PDF văn bản (~10 trang), trích text ~50ms, gửi text thay vì base64 → giảm payload đáng kể, model xử lý trực tiếp không cần OCR → **tiết kiệm 1–3s**.

### 3.5.3 Dependency

Dự án đã có `pdfjs-dist` (import ở `components/contracts/...`). Cần kiểm tra:

```bash
npm list pdfjs-dist
```

Nếu chưa có → cài dev dependency: `npm install -D pdfjs-dist@4.9.155`.

### 3.5.4 Module mới: `lib/ai/pdf-text.ts`

```ts
import "server-only";

/**
 * Extracts selectable text from a PDF using PDF.js.
 * Returns null if the PDF is likely a scanned/image-only document.
 *
 * Strategy:
 * 1. Load PDF with PDF.js (disable GPU rendering).
 * 2. Scan first 3 pages for text content.
 * 3. If total text length > MIN_TEXT_LENGTH → return extracted text.
 * 4. Otherwise → return null (likely scanned).
 */
export async function extractPdfText(
  buffer: Buffer,
  options?: { maxPages?: number; minTextLength?: number },
): Promise<{ text: string; pageCount: number } | null> {
  const { maxPages = 3, minTextLength = 100 } = options ?? {};

  // Dynamically import pdfjs-dist (server-only, không bundle vào client)
  const pdfjsLib = await import("pdfjs-dist");

  // Set worker source (inline blob URL để tránh CORS / file not found)
  // Worker được tải từ CDN của pdfjs-dist, hoặc dùng bundled worker nếu có
  // Quan trọng: worker chỉ chạy server-side, không bao giờ gửi đến client
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    useSystemFonts: true,
    disableFontFace: true, // Server-side, không cần font rendering
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  let totalText = "";

  // Chỉ đọc N trang đầu để quyết định nhanh
  const pagesToScan = Math.min(pageCount, maxPages);

  for (let i = 1; i <= pagesToScan; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ")
      .trim();
    totalText += pageText + "\n";
  }

  // Nếu lượng text đủ lớn → có text layer → trả về text
  if (totalText.length >= minTextLength) {
    return { text: totalText.trim(), pageCount };
  }

  return null; // Likely scanned → dùng luồng image/PDF
}

/**
 * Checks if the first N pages of a PDF contain sufficient selectable text.
 */
export async function hasPdfTextLayer(
  buffer: Buffer,
  options?: { maxPages?: number; minTextLength?: number },
): Promise<boolean> {
  const result = await extractPdfText(buffer, options);
  return result !== null;
}
```

### 3.5.5 Cập nhật `extractContractFromBuffer` (lib/ai/gemini.ts)

```ts
// Thêm import
import { extractPdfText } from "@/lib/ai/pdf-text";

export async function extractContractFromBuffer({
  buffer,
  mimeType,
  filename = "",
}: {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}): Promise<ServiceResult<ExtractedContract>> {
  // ... existing validation code ...

  // === NEW: Ưu tiên trích văn bản từ PDF dạng văn bản ===
  if (resolvedMime === "application/pdf") {
    const pdfResult = await extractPdfText(buffer);
    if (pdfResult) {
      // Có text layer → gửi văn bản thuần cho Gemini (nhanh hơn)
      const textResult = await callGeminiWithText(pdfResult.text, apiKey, models, perModelTimeout);
      if (textResult.ok) return textResult;
      // Nếu thất bại → fallback xuống luồng base64
    }
  }
  // === END NEW ===

  // Luồng hiện tại: base64 PDF/image
  const base64Data = buffer.toString("base64");
  // ... rest of existing code ...
}
```

**Lưu ý:**
- Cần tạo helper `callGeminiWithText` (tái sử dụng logic gọi API hiện có) hoặc gộp chung vào `extractContractFromBuffer`.
- Nếu text extraction fail hoặc trả về null → fallback về base64 như cũ.
- Không làm thay đổi API public signature (vẫn trả `ServiceResult<ExtractedContract>`).

### 3.5.6 Điều chỉnh test

Thêm unit test cho `extractPdfText`:

| Test | Verify |
|---|---|
| `extractPdfText trả về null cho scanned PDF` | Pass buffer nhỏ, text < minTextLength → null |
| `extractPdfText trả về text + pageCount cho PDF có text layer` | Mock PDF với text content |
| `hasPdfTextLayer trả true khi đủ text` | Text length > 100 → true |
| `hasPdfTextLayer trả false khi không đủ text` | Text length < 100 → false |

### 3.5.7 Điều chỉnh effort

| Task | Thời gian |
|---|---|
| §3.1–3.4 (đã xong) | ~60 phút |
| Cài pdfjs-dist@4.9.155 nếu chưa có | 5 phút |
| Tạo `lib/ai/pdf-text.ts` (~50 dòng) | 20 phút |
| Tích hợp vào `extractContractFromBuffer` | 15 phút |
| Unit test cho pdf-text | 20 phút |
| **Tổng bổ sung §3.5** | **~60 phút** |
| **Tổng R34 (all)** | **~120 phút (2 giờ)** |

---

## 6. TEST

### 6.1 Unit test

Cập nhật `tests/unit/ai-extract.test.ts` nếu có mock `getGeminiModels`:

| Test | Thay đổi |
|---|---|
| `getGeminiModels trả về env model lên đầu khi set` | Thêm case: `GEMINI_MODEL=gemini-3.5-flash-lite` → output[0] === `gemini-3.5-flash-lite` |
| `getGeminiModels không trùng lặp khi env model trong defaults` | `GEMINI_MODEL=gemini-3.5-flash-lite` → array không chứa 2 lần `gemini-3.5-flash-lite` |
| `getGeminiModels fallback đúng thứ tự` | Không env → [0] === `gemini-3.5-flash-lite` |

### 6.2 Integration test

Có `GEMINI_API_KEY` thật → chạy `pnpm test:integration` để verify:
- Extraction vẫn trả về JSON hợp lệ với model mới.
- `thinkingConfig` không gây lỗi 400.

Nếu **không có** `GEMINI_API_KEY` → skip integration test.

### 6.3 E2E test

`pnpm test:e2e` — verify flow extract trong browser vẫn hoạt động:
- Upload file nhỏ (< 1 MB) → gọi inline data.
- Upload file lớn (> 1 MB) → upload R2 → extract.
- Kết quả fill vào form đúng.

---

## 7. CHECKLIST CHO T2

- [ ] Đọc file này + `lib/ai/gemini.ts` + `app/(app)/contracts/actions.ts`
- [ ] Verify `GEMINI_API_KEY` SET (in SET/EMPTY/độ dài — KHÔNG in giá trị)
- [ ] Sửa `getGeminiModels()` theo §3.1
- [ ] Thêm `thinkingConfig` theo §3.2
- [ ] Giới hạn `MAX_RETRIES = 2` theo §3.3
- [ ] Song song hoá 3 queries trong `extractContractAction` theo §3.4
- [ ] Cập nhật unit test cho `getGeminiModels` nếu có
- [ ] Chạy `pnpm typecheck && pnpm lint && pnpm build && pnpm test --run`
- [ ] Nếu `GEMINI_API_KEY` SET → chạy `pnpm test:integration`
- [ ] Chạy `pnpm test:e2e`
- [ ] Báo cáo 5 mục (KHÔNG push — đợi T1 duyệt)
- [ ] Commit message: `perf(ai): ưu tiên gemini-3.5-flash-lite, thêm thinkingConfig, giới hạn retry, song song hoá Supabase queries`
