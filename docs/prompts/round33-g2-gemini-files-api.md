# G2 (Round 33) — Refactor AI extraction sang Gemini Files API (T1 → T2) — DỰ THẢO, CHỜ T1 DUYỆT CUỐI

> Tài liệu giao việc T1 in cho T2. Sau khi T2 gửi report, T1 review → chốt → in prompt tiếp theo. **T2 KHÔNG push.**

## Trạng thái mới (T1 verify 2026-10-17)

| Mục | Trạng thái |
|---|---|
| HEAD local | `df926b9` (kế hoạch G2 + sửa 1 dòng ci.yml) trên branch `cursor/ai-gemini-key-and-extract-test` |
| HEAD origin main | `a0e2cda` (round 29 + 31) — đã push, tree sạch |
| Branch đích | `feat/ai-gemini-files-api` (T2 tạo, KHÔNG push tự động) |
| Kế hoạch chi tiết | `docs/plan/g2-gemini-files-api.md` — **ĐỌC TRƯỚC** |
| Test ID thống nhất | KHÔNG thêm testid mới (giữ nguyên các testid hiện có trong `tests/e2e/contracts.spec.ts`) |
| Dữ liệu production | 144 đối tác thật + audit_logs thật — **KHÔNG đụng** |
| Tài khoản test | `e2e.wave2@hrpartner.vn` (password trong `.env.local` — **không xoá**) |

## Bối cảnh

Owner báo "AI đọc văn bản quá chậm". T1 đã rà soát (`docs/plan/g2-gemini-files-api.md` mục 1.1) và xác định 4 chặng tuần tự với tổng thời gian ~12–45 giây cho file 10–20 MB:

1. Presign R2 (~300–500 ms)
2. Upload qua R2 (~3–8 s)
3. **Server tải lại file từ R2 về Next rồi mới gọi AI** (~2–4 s)
4. Gọi Gemini `generateContent` với **inline base64** (~6–36 s, 3 model × 12s)

Trong đó **chặng 3 + base64 của chặng 4** là thừa — file không bao giờ dùng lại trong Next, chỉ pass tới Gemini.

**Giải pháp**: thay `inlineData` base64 (flow hiện tại) bằng **Gemini Files API**. Upload file 1 lần, nhận `fileUri`, gọi `generateContent` với `fileData.fileUri` — body chỉ còn prompt + URI (vài KB thay vì 26 MB cho file 20 MB).

**Tác động ước tính**: giảm 20–60% latency cho file lớn; giảm chi phí bandwidth Vercel↔Gemini; giảm RAM serverless.

**Chi tiết kỹ thuật đầy đủ**: xem `docs/plan/g2-gemini-files-api.md` (T1 đã viết, đã commit ở `df926b9`).

## Ràng buộc bắt buộc

- **REUSE FIRST** (rule §3): tận dụng `getObjectBuffer` hiện có ở `lib/r2/objects.ts`; tận dụng `extractContractFromBuffer` signature hiện tại (mở rộng, không phá).
- **Backward compatible**: giữ `inlineData` làm fallback khi không có `geminiFileName` (dùng cho test mock).
- **Cleanup bắt buộc**: file Gemini có TTL 48h, **phải xoá sau khi extract** (kể cả khi extract fail) — đặt trong `finally`. Nếu xoá fail → log warn, KHÔNG chặn nghiệp vụ.
- **B9 (gộp từ báo cáo 2026-10-17)**: thay thế 4 chỗ `console.log/warn` thẳng trong `lib/ai/gemini.ts` (dòng ~170, 226, 257, 281) bằng logger có cấu trúc `lib/ai/log.ts` (xem chi tiết ở `docs/plan/g2-gemini-files-api.md` mục 10).
- **KHÔNG đổi UI** ở `components/contracts/contract-form.tsx` — chỉ phần server đổi. User experience giữ nguyên.
- **KHÔNG push tự động** (rule §5 mục 4). Commit lên branch `feat/ai-gemini-files-api` rồi dừng.
- **Tiếng Việt 100%** trong UI, log, commit message, báo cáo (rule §1).
- **KHÔNG in credential** (rule §2). Khi xác nhận `GEMINI_API_KEY` chỉ in **tên biến + SET/EMPTY/độ dài**, không in giá trị.

## Việc của T2

### 1. Tạo branch + verify môi trường

```bash
cd D:\HRP-app\Contract-mange-hrp
git fetch origin
git checkout -b feat/ai-gemini-files-api
```

**Verify môi trường** (báo cáo bằng `SET`/`EMPTY`/`độ dài` — KHÔNG in giá trị):

| Biến | Cần | Ghi chú |
|---|---|---|
| `GEMINI_API_KEY` | SET, ~39 ký tự (chuẩn `AIzaSy...`) | Server-only |
| `NEXT_PUBLIC_SUPABASE_URL` | SET | |
| `SUPABASE_SERVICE_ROLE_KEY` | SET | Server-only |
| `R2_*` (6 biến) | SET | |

**Nếu `GEMINI_API_KEY` EMPTY** → báo T1 ngay, không code tiếp (vì không verify được end-to-end).

### 2. Đọc lại 5 file (bắt buộc trước khi code)

- `docs/plan/g2-gemini-files-api.md` — kế hoạch chi tiết T1 đã viết (đọc kỹ §3)
- `lib/ai/gemini.ts` — module cần refactor (293 dòng, có fallback chain 3 model)
- `app/(app)/contracts/actions.ts` — server action `extractContractAction` (~430 dòng)
- `app/api/ai/upload-url/route.ts` — presign R2 (60 dòng, KHÔNG cần đổi)
- `tests/unit/ai-extract.test.ts` — test mẫu (515 dòng, mock `global.fetch`)

### 3. Code

#### 3.1 Tạo module mới `lib/ai/gemini-files.ts`

Theo đúng spec ở `docs/plan/g2-gemini-files-api.md` §3.1. Lưu ý:
- Multipart upload format đúng Google spec (X-Goog-Upload-Protocol: multipart).
- Return `ServiceResult<GeminiFile>` để consistent với pattern hiện có (`lib/services/types.ts`).
- `deleteGeminiFile` **không throw** — chỉ log warn.

#### 3.2 Mở rộng `lib/ai/gemini.ts`

Thêm overload mới cho `extractContractFromBuffer` (KHÔNG thay đổi function cũ) — dùng `union` parameter:

```ts
export type ExtractInput =
  | { buffer: Buffer; mimeType: string; filename?: string }
  | { geminiFileName: string; geminiFileUri: string; mimeType: string };

export async function extractContractFromBuffer(
  input: ExtractInput,
): Promise<ServiceResult<ExtractedContract>>;
```

Theo §3.2 của kế hoạch: nếu có `geminiFileName` thì body dùng `fileData.fileUri`; nếu không thì fallback `inlineData` base64 (giữ nguyên code hiện tại).

**Đồng thời (B9)**: thay thế 4 chỗ `console.log/warn` ở dòng ~170, 226, 257, 281 bằng `aiLog` (xem `docs/plan/g2-gemini-files-api.md` §10.3 bảng ánh xạ chính xác). Tạo `lib/ai/log.ts` trước.

**KHÔNG thay đổi**: signature `Promise<ServiceResult<ExtractedContract>>`, tên function, prompt, fallback chain 3 model × 12s.

#### 3.3 Sửa `extractContractAction` ở `app/(app)/contracts/actions.ts`

Theo §3.3 của kế hoạch:
- Lấy `apiKey = process.env.GEMINI_API_KEY?.trim()` ở đầu action (thay vì để `lib/ai/gemini.ts` tự đọc).
- Upload lên Gemini Files bằng `uploadToGeminiFiles()` (cho cả đường R2 lẫn FormData).
- Gọi `extractContractFromBuffer({ geminiFileName, geminiFileUri, mimeType })`.
- **Cleanup trong `finally`**: `deleteGeminiFile(name, apiKey).catch(...)` + (giữ nguyên) `deleteObject(objectKey).catch(() => {})`.

### 4. Test

#### 4.1 Unit test (bắt buộc, chạy không cần key thật)

Thêm vào `tests/unit/ai-extract.test.ts` theo §4.1 của kế hoạch:

| Test case | Verify |
|---|---|
| `uploadToGeminiFiles gửi multipart đúng format` | Content-Type `multipart/related; boundary=...`, body có JSON metadata + bytes |
| `deleteGeminiFile gọi đúng URL` | `DELETE .../files/{name}?key=...` |
| `extractContractFromBuffer dùng fileData khi có URI` | Body có `fileData.fileUri`, KHÔNG có `inlineData` |
| `extractContractFromBuffer fallback inlineData khi không có URI` | Body giống code cũ |
| `extractContractFromBuffer không để rò rỉ file khi parse fail` | `deleteGeminiFile` được gọi dù extract fail (mock verify) |

**Bổ sung B9 (2 test cho logger)**:
| Test case | Verify |
|---|---|
| `aiLog.info ghi ra stdout với JSON hợp lệ` | Mock `console.log`, gọi `aiLog.info("test", { model: "x" })` → output có `"level":"info"`, `"scope":"ai:gemini"`, `"model":"x"` |
| `aiLog.error đi ra stderr, không ra stdout` | Mock `console.error` + `console.log`, gọi `aiLog.error(...)` → chỉ `console.error` được gọi |

#### 4.2 Integration test (KHÔNG BẮT BUỘC — chỉ chạy nếu `GEMINI_API_KEY` SET)

File mới: `tests/integration/ai-extract-gemini.test.ts`.

**Tự skip khi `GEMINI_API_KEY` EMPTY** (giống pattern `hasLiveBackend` ở `tests/e2e/helpers.ts`).

Nếu có key thật:
- Upload 1 file PDF mẫu (~10 KB).
- Extract.
- Verify trả JSON hợp lệ.
- Verify file đã cleanup (gọi `files.get({name})` → 404).

**Lưu ý**: test này có thể chậm 10–30 s do Gemini API. Set timeout 60 s cho test này.

#### 4.3 E2E test (giữ nguyên, không thêm)

Các e2e hiện có ở `tests/e2e/contracts.spec.ts` đã cover flow "AI extract" với test `extractContractAction`. **KHÔNG thêm** e2e mới. Sau khi G2 xong, **phải chạy lại e2e** để đảm bảo UI không đổi.

### 5. Gate

Chạy lần lượt (báo cáo kết quả THẬT):

```bash
pnpm typecheck      # phải pass
pnpm lint           # phải pass, 0 warning
pnpm build          # phải pass — kiểm tra import mới + maxDuration
pnpm test --run     # unit, BAO GỒM 5 test mới
pnpm test:integration   # nếu GEMINI_API_KEY SET → chạy spec mới; EMPTY → skip
pnpm test:e2e       # phải pass, BAO GỒM e2e extract
```

Nếu **bất kỳ** bước nào fail → sửa rồi chạy lại. **KHÔNG skip** trừ khi T1 đã duyệt.

### 6. Commit + tạo PR nháp (KHÔNG push lên main, KHÔNG merge)

```bash
git add -A
git commit -m "feat(ai): refactor sang Gemini Files API để giảm latency AI đọc hợp đồng

- Thêm lib/ai/gemini-files.ts (upload + delete file tạm)
- Mở rộng extractContractFromBuffer: chấp nhận cả fileData URI lẫn buffer base64 (backward-compatible)
- Sửa extractContractAction: stream từ R2 → Gemini Files, cleanup trong finally
- Thêm 5 unit test cho Gemini Files API
- Effort: G2 (kế hoạch docs/plan/g2-gemini-files-api.md)"
git push origin feat/ai-gemini-files-api
```

Tạo PR nháp trên GitHub (chế độ draft) với target = `main`.

### 7. Báo cáo 5 mục (theo rule §5)

Viết vào message commit hoặc 1 file mới `docs/prompts/round33-report.md`:

1. **Đã làm** — theo từng bước, kèm file + commit.
2. **Kết quả kiểm chứng** — lệnh đã chạy + kết quả thật (số test pass/tổng, build pass/fail). KHÔNG nói "đã xong" không có bằng chứng.
3. **Lệch so với prompt** — nếu làm khác chỉ dẫn, nói rõ và giải thích lý do.
4. **Tự động commit/push?** — đã push lên branch `feat/ai-gemini-files-api`, **CHƯA tạo PR merge vào main** (chờ T1 duyệt).
5. **Vấn đề còn lại / rủi ro** — kể cả thứ mình không kiểm được.

### 8. KHÔNG ĐƯỢC LÀM

- ❌ Đổi UI ở `components/contracts/contract-form.tsx`.
- ❌ Đổi signature cũ của `extractContractFromBuffer` (chỉ mở rộng).
- ❌ Push/merge vào `main` hoặc `origin/main` mà chưa có duyệt của T1/Owner.
- ❌ Commit file `GEMINI_API_KEY` thật (rule §2). Nếu phát hiện commit trước có secret (vd `ab8ff91`) → **báo T1 ngay** trước khi tiếp tục.
- ❌ Xoá user `e2e.wave2@hrpartner.vn` hoặc đụng dữ liệu production (rule §6).
- ❌ Thêm dependency mới (giữ nguyên `package.json` — Gemini Files API dùng `fetch` có sẵn).

## Acceptance criteria

G2 hoàn thành khi **TẤT CẢ** điều kiện sau đều đúng:

- [ ] `pnpm typecheck` PASS
- [ ] `pnpm lint` PASS, 0 warning
- [ ] `pnpm build` PASS
- [ ] `pnpm test --run` PASS (gồm 5 test mới ở §4.1)
- [ ] `pnpm test:e2e` PASS (giữ nguyên specs)
- [ ] `lib/ai/gemini-files.ts` được tạo với 2 function: `uploadToGeminiFiles`, `deleteGeminiFile`
- [ ] `lib/ai/log.ts` được tạo với logger `aiLog.info/warn/error` (B9)
- [ ] 4 chỗ `console.log/warn` ở `lib/ai/gemini.ts` đã được thay bằng `aiLog` (B9)
- [ ] `extractContractFromBuffer` chấp nhận cả 2 dạng input (backward-compat)
- [ ] `extractContractAction` cleanup Gemini file trong `finally` (verify được trong test)
- [ ] Báo cáo 5 mục đầy đủ + bằng chứng test pass
- [ ] Commit message tiếng Việt + theo format conventional commits
- [ ] KHÔNG có `GEMINI_API_KEY` thật trong diff (`git diff main` không chứa `AIzaSy...`)
- [ ] Branch `feat/ai-gemini-files-api` đã push, draft PR tạo, chờ T1 review

---

> **Ghi chú cuối**: prompt này do T1 soạn từ kế hoạch `docs/plan/g2-gemini-files-api.md` (đã commit ở `df926b9`). T2 nếu thấy mâu thuẫn giữa prompt và kế hoạch → **báo T1** trước khi code (rule §4).
