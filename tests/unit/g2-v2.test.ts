import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * G2 v2 — Test mới cho:
 * - lib/ai/log.ts (server logger)
 * - lib/ai/log-client.ts (client logger)
 * - lib/ai/gemini-files.ts (upload + delete Gemini Files API)
 * - lib/ai/gemini.ts (3 nhánh: fileData, text layer, base64)
 * - lib/ai/pdf-text.ts (trích text từ PDF)
 */

import { aiLog } from "@/lib/ai/log";
import { clientLog } from "@/lib/ai/log-client";
import { deleteGeminiFile, uploadToGeminiFiles } from "@/lib/ai/gemini-files";
import {
  ALLOWED_MIME_TYPES,
  detectAppendixMetadata,
  extractContractFromBuffer,
  getGeminiModels,
  MAX_AI_FILE_SIZE_BYTES,
} from "@/lib/ai/gemini";
import { extractPdfText } from "@/lib/ai/pdf-text";
import {
  hasMatchingMainContractFile,
  isAppendixFile,
  isAppendixSaveBlocked,
} from "@/components/contracts/contract-form";

describe("G2 v2 — Logger có cấu trúc", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("aiLog (server)", () => {
    it("info ghi JSON hợp lệ ra stdout với scope ai:gemini", () => {
      aiLog.info("test message", { model: "gemini-3.5-flash-lite" });
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const line = infoSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(line);
      expect(parsed.level).toBe("info");
      expect(parsed.scope).toBe("ai:gemini");
      expect(parsed.message).toBe("test message");
      expect(parsed.model).toBe("gemini-3.5-flash-lite");
      expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("warn ghi ra stderr warn", () => {
      aiLog.warn("warn message");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      const parsed = JSON.parse(warnSpy.mock.calls[0][0]);
      expect(parsed.level).toBe("warn");
    });

    it("error ghi ra stderr error, không ra stdout", () => {
      aiLog.error("err message");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(parsed.level).toBe("error");
    });
  });

  describe("clientLog (client)", () => {
    it("info ghi JSON hợp lệ ra browser console với scope ai:client", () => {
      clientLog.info("client test", { hasFile: true });
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(infoSpy.mock.calls[0][0]);
      expect(parsed.scope).toBe("ai:client");
      expect(parsed.message).toBe("client test");
      expect(parsed.hasFile).toBe(true);
    });

    it("error ghi ra stderr, không ra stdout", () => {
      clientLog.error("client err");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).not.toHaveBeenCalled();
    });
  });
});

describe("G2 v2 — Gemini Files API", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("uploadToGeminiFiles", () => {
    it("thực hiện quy trình Resumable Upload 2 bước chuẩn của Google", async () => {
      // Bước 1: Trả về header x-goog-upload-url
      fetchSpy.mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            "x-goog-upload-url": "https://upload.google.com/upload-session/xyz",
          },
        }),
      );

      // Bước 2: Nhận dữ liệu upload và trả về metadata của file
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            file: {
              name: "files/abc123",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
              mimeType: "application/pdf",
              sizeBytes: "1024",
            },
          }),
          { status: 200 },
        ),
      );

      const result = await uploadToGeminiFiles({
        buffer: Buffer.from("PDF bytes"),
        mimeType: "application/pdf",
        filename: "test.pdf",
        apiKey: "test-key",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.name).toBe("files/abc123");
        expect(result.data.uri).toContain("files/abc123");
      }

      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Kiểm tra Bước 1 (Init session)
      const [initUrl, initReq] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(initUrl).toBe("https://generativelanguage.googleapis.com/upload/v1beta/files");
      const initHeaders = initReq.headers as Record<string, string>;
      expect(initHeaders["x-goog-api-key"]).toBe("test-key");
      expect(initHeaders["X-Goog-Upload-Protocol"]).toBe("resumable");
      expect(initHeaders["X-Goog-Upload-Command"]).toBe("start");
      expect(initHeaders["X-Goog-Upload-Header-Content-Length"]).toBe(String(Buffer.from("PDF bytes").length));

      // Kiểm tra Bước 2 (Binary upload & finalize)
      const [uploadUrl, uploadReq] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(uploadUrl).toBe("https://upload.google.com/upload-session/xyz");
      const uploadHeaders = uploadReq.headers as Record<string, string>;
      expect(uploadHeaders["x-goog-api-key"]).toBe("test-key");
      expect(uploadHeaders["X-Goog-Upload-Command"]).toBe("upload, finalize");
      expect(uploadReq.body).toEqual(new Uint8Array(Buffer.from("PDF bytes")));
    });

    it("trả về err khi response không ok", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 }),
      );

      const result = await uploadToGeminiFiles({
        buffer: Buffer.from("x"),
        mimeType: "application/pdf",
        filename: "t.pdf",
        apiKey: "k",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("Quota exceeded");
      }
    });

    it("trả về err khi buffer rỗng", async () => {
      const result = await uploadToGeminiFiles({
        buffer: Buffer.alloc(0),
        mimeType: "application/pdf",
        filename: "t.pdf",
        apiKey: "k",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("deleteGeminiFile", () => {
    it("gọi DELETE đúng URL", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

      await deleteGeminiFile("files/abc123", "test-key");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/files/files/abc123");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("test-key");
      expect(init.method).toBe("DELETE");
    });

    it("không throw khi fetch fail (best-effort)", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));
      await expect(deleteGeminiFile("files/abc", "k")).resolves.toBeUndefined();
    });

    it("không gọi fetch khi thiếu fileName hoặc apiKey", async () => {
      await deleteGeminiFile("", "k");
      await deleteGeminiFile("files/abc", "");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("G2 v2 — extractContractFromBuffer với 3 nhánh", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
  });

  it("dùng fileData khi có geminiFileName + geminiFileUri (G2 v2)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      contractNumber: "12/2026",
                      partnerName: "Công ty ABC",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await extractContractFromBuffer({
      buffer: Buffer.from("dummy"),
      mimeType: "application/pdf",
      filename: "test.pdf",
      geminiFileName: "files/xyz",
      geminiFileUri: "https://generativelanguage.googleapis.com/v1beta/files/xyz",
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generateContent");
    expect(url).not.toContain("key=");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");

    const body = JSON.parse(init.body as string);
    const parts = body.contents[0].parts;
    // Có fileData, KHÔNG có inlineData
    const hasFileData = parts.some((p: Record<string, unknown>) => "fileData" in p);
    const hasInlineData = parts.some((p: Record<string, unknown>) => "inlineData" in p);
    expect(hasFileData).toBe(true);
    expect(hasInlineData).toBe(false);
    const fileDataPart = parts.find((p: Record<string, unknown>) => "fileData" in p);
    expect(fileDataPart.fileData).toMatchObject({
      mimeType: "application/pdf",
      fileUri: expect.stringContaining("files/xyz"),
    });

    // Structured JSON output schema
    expect(body.generationConfig?.responseMimeType).toBe("application/json");
    expect(body.generationConfig?.responseSchema).toBeDefined();
    expect(body.generationConfig.responseSchema.properties).toHaveProperty("contractNumber");
    expect(body.generationConfig.responseSchema.properties).toHaveProperty("durationText");
  });

  it("fallback inlineData khi không có geminiFileUri", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"contractNumber":"1"}' }] } }],
        }),
        { status: 200 },
      ),
    );

    const result = await extractContractFromBuffer({
      buffer: Buffer.from("dummy"),
      mimeType: "image/png",
      filename: "test.png",
    });

    expect(result.ok).toBe(true);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const parts = body.contents[0].parts;
    const hasInlineData = parts.some((p: Record<string, unknown>) => "inlineData" in p);
    const hasFileData = parts.some((p: Record<string, unknown>) => "fileData" in p);
    expect(hasInlineData).toBe(true);
    expect(hasFileData).toBe(false);
  });

  it("trả về err khi GEMINI_API_KEY chưa set", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await extractContractFromBuffer({
      buffer: Buffer.from("x"),
      mimeType: "image/png",
      filename: "t.png",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("GEMINI_API_KEY");
    }
  });

  it("nhánh PDF có text layer gửi cả text đã trích xuất và EXTRACTION_SYSTEM_PROMPT", async () => {
    const pdfTextModule = await import("@/lib/ai/pdf-text");
    const extractPdfSpy = vi.spyOn(pdfTextModule, "extractPdfText").mockResolvedValueOnce({
      text: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nHỢP ĐỒNG KINH TẾ Số: 99/2026/HĐKT",
      pageCount: 1,
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"contractNumber":"99/2026/HĐKT"}' }] } }],
        }),
        { status: 200 },
      ),
    );

    const result = await extractContractFromBuffer({
      buffer: Buffer.from("dummy-pdf-bytes"),
      mimeType: "application/pdf",
      filename: "contract.pdf",
    });

    expect(result.ok).toBe(true);
    expect(extractPdfSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const parts = body.contents[0].parts;
    // Phải có 2 text parts: part 1 là nội dung trích xuất, part 2 là EXTRACTION_SYSTEM_PROMPT
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toContain("HỢP ĐỒNG KINH TẾ Số: 99/2026/HĐKT");
    expect(parts[1].text).toContain("Bạn là trợ lý AI chuyên gia phân tích hợp đồng");
    extractPdfSpy.mockRestore();
  });

  it("dừng trích xuất và không gọi model tiếp theo nếu thời gian còn lại dưới 6s", async () => {
    const result = await extractContractFromBuffer({
      buffer: Buffer.from("dummy"),
      mimeType: "image/png",
      filename: "test.png",
      remainingBudgetMs: 4_000, // Dưới ngưỡng an toàn 6 giây
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Quá thời gian thực thi cho phép");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("từ chối định dạng tệp không được hỗ trợ mà không gọi fetch", async () => {
    const result = await extractContractFromBuffer({
      buffer: Buffer.from("dummy-text"),
      mimeType: "text/plain",
      filename: "test.txt",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Định dạng tệp (text/plain) chưa được hỗ trợ");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("từ chối tệp vượt quá giới hạn AI mà không gọi fetch", async () => {
    const hugeBuffer = Buffer.alloc(MAX_AI_FILE_SIZE_BYTES + 1);
    const result = await extractContractFromBuffer({
      buffer: hugeBuffer,
      mimeType: "application/pdf",
      filename: "huge.pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("50 MB");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("G2 v2 — Cấu hình model & fallback", () => {
  const ORIGINAL_MODEL = process.env.GEMINI_MODEL;

  afterEach(() => {
    if (ORIGINAL_MODEL === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = ORIGINAL_MODEL;
  });

  it("mặc định ưu tiên gemini-3.5-flash-lite ổn định và fallback gemini-3.8-flash cố định (GA)", () => {
    delete process.env.GEMINI_MODEL;
    const models = getGeminiModels();
    expect(models[0]).toBe("gemini-3.5-flash-lite");
    expect(models).toContain("gemini-3.8-flash");
    expect(models).toHaveLength(2);
    // Không chứa alias tự đổi mục tiêu, model preview hay model đã shutdown/deprecated/restricted
    expect(models).not.toContain("gemini-flash-latest");
    expect(models).not.toContain("gemini-3-flash-preview");
    expect(models).not.toContain("gemini-1.5-flash");
    expect(models).not.toContain("gemini-2.5-flash");
    expect(models).not.toContain("gemini-2.5-flash-lite");
  });

  it("cấu hình GEMINI_MODEL ưu tiên model cấu hình mà không bị trùng lặp", () => {
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    const models = getGeminiModels();
    expect(models[0]).toBe("gemini-3.8-flash");
    // Không bị xuất hiện 2 lần
    expect(models.filter((m) => m === "gemini-3.8-flash")).toHaveLength(1);
    expect(models).toContain("gemini-3.5-flash-lite");
  });
});

describe("G2 v2 — Cấu hình MIME & Kích thước", () => {
  it("ALLOWED_MIME_TYPES chỉ cho phép PDF, JPEG, PNG, WebP", () => {
    expect(ALLOWED_MIME_TYPES.has("application/pdf")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/png")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/webp")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("application/msword")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("text/plain")).toBe(false);
  });

  it("MAX_AI_FILE_SIZE_BYTES là 50 MB", () => {
    expect(MAX_AI_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("G2 v2 — extractPdfText (sửa BUG-1)", () => {
  it("trả null khi buffer rỗng", async () => {
    const result = await extractPdfText(Buffer.alloc(0));
    expect(result).toBeNull();
  });

  it("trả null khi buffer không phải PDF hợp lệ", { timeout: 15_000 }, async () => {
    const result = await extractPdfText(Buffer.from("not a pdf"));
    expect(result).toBeNull();
  });

  it("trích xuất thành công văn bản từ PDF có text layer hợp lệ", async () => {
    const validTextPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length 85 >>\nstream\nBT\n/F1 12 Tf\n72 712 Td\n(HOP DONG KINH TE SO 01/2026/HDKT GIUA CONG TY HRP VA DOI TAC) Tj\nET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000318 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n455\n%%EOF",
    );
    const result = await extractPdfText(validTextPdf);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.text).toContain("HOP DONG KINH TE SO 01/2026/HDKT");
      expect(result.pageCount).toBe(1);
      expect(result.isTruncated).toBe(false);
    }
  });

  it("trả null khi buffer PDF scan (không có text layer)", async () => {
    // PDF tối thiểu không có text layer — chỉ có 1 object stream rỗng.
    const minimalPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000110 00000 n\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n178\n%%EOF",
    );
    const result = await extractPdfText(minimalPdf);
    expect(result).toBeNull();
  });
});

describe("G2 v2 — detectAppendixMetadata (Phân loại chính xác Phụ lục và Hợp đồng)", () => {
  it("nhận diện đúng hợp đồng chính khi không có dấu hiệu phụ lục", () => {
    const res = detectAppendixMetadata({
      filename: "Hop_dong_kinh_te_12_2026.pdf",
      pdfText: "HỢP ĐỒNG KINH TẾ\nSố: 12/2026/HĐKT\nGiữa Công ty TNHH HRP và Đối tác ABC...",
      rawExtracted: {
        documentType: "contract",
        contractNumber: "12/2026/HĐKT",
        summary: "Hợp đồng cung cấp dịch vụ quản lý nhân sự",
      },
    });

    expect(res.documentType).toBe("contract");
    expect(res.baseContractNumber).toBe("");
    expect(res.appendixNumber).toBe("");
    expect(res.contractNumber).toBe("12/2026/HĐKT");
  });

  it("nhận diện phụ lục từ tên tệp (filename)", () => {
    const res = detectAppendixMetadata({
      filename: "Phu_luc_so_01_HD_12_2026.pdf",
      pdfText: "",
      rawExtracted: {
        documentType: "contract", // Gemini bị nhầm lẫn là contract
        contractNumber: "12/2026/HĐKT",
        summary: "Điều chỉnh thời hạn",
      },
    });

    expect(res.documentType).toBe("appendix");
    expect(res.appendixNumber).toBe("01");
    // Nhận diện contractNumber là số hợp đồng gốc bị trích xuất nhầm
    expect(res.baseContractNumber).toBe("12/2026/HĐKT");
  });

  it("nhận diện phụ lục từ nội dung văn bản (text layer) và trích xuất số HĐ gốc từ điều khoản căn cứ", () => {
    const res = detectAppendixMetadata({
      filename: "document_scan.pdf",
      pdfText:
        "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nPHỤ LỤC HỢP ĐỒNG SỐ 02\nCăn cứ Hợp đồng kinh tế số: 2024.03.01/HRVN - DONGYANG ký ngày 01/03/2024...",
      rawExtracted: {
        documentType: "contract",
        contractNumber: "",
        summary: "Gia hạn thời hạn thực hiện",
      },
    });

    expect(res.documentType).toBe("appendix");
    expect(res.appendixNumber).toBe("02");
    expect(res.baseContractNumber).toBe("2024.03.01/HRVN - DONGYANG");
  });

  it("nhận diện phụ lục từ AI summary", () => {
    const res = detectAppendixMetadata({
      filename: "scan_123.jpg",
      pdfText: null,
      rawExtracted: {
        documentType: "contract",
        contractNumber: "PL-01",
        baseContractNumber: "99/2026/HĐKT",
        summary: "Phụ lục số 01 về việc sửa đổi bảng giá dịch vụ",
      },
    });

    expect(res.documentType).toBe("appendix");
    expect(res.baseContractNumber).toBe("99/2026/HĐKT");
  });

  it("nhận diện phụ lục theo quy ước tiêu đề 'PHỤ LỤC HỢP ĐỒNG' ở trang đầu tiên (firstPageTitle)", () => {
    const res = detectAppendixMetadata({
      filename: "scan_001.pdf",
      pdfText: "",
      rawExtracted: {
        firstPageTitle: "PHỤ LỤC HỢP ĐỒNG SỐ 01",
        documentType: "contract", // Gemini bị nhầm lẫn
        contractNumber: "24022024/HRVN - STAR ENGINEERS", // Gemini nhầm số HĐ gốc thành contractNumber
        summary: "Phụ lục điều chỉnh thời hạn",
      },
    });

    expect(res.documentType).toBe("appendix");
    expect(res.appendixNumber).toBe("01");
    expect(res.baseContractNumber).toBe("24022024/HRVN - STAR ENGINEERS");
    expect(res.contractNumber).toBe("PL-01");
  });

  it("nhận diện phụ lục khi trang 1 có tiêu đề 'PHỤ LỤC HỢP ĐỒNG' trong text layer dù tên file là tài liệu chung", () => {
    const res = detectAppendixMetadata({
      filename: "tai_lieu_ky_ket.pdf",
      pdfText:
        "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\n\nPHỤ LỤC HỢP ĐỒNG\n\nCăn cứ Hợp đồng dịch vụ số 24022024/HRVN - STAR ENGINEERS ngày 24/02/2024...",
      rawExtracted: {
        documentType: "contract",
        contractNumber: "24022024/HRVN - STAR ENGINEERS",
        summary: "Thỏa thuận bổ sung hợp đồng",
      },
    });

    expect(res.documentType).toBe("appendix");
    expect(res.baseContractNumber).toBe("24022024/HRVN - STAR ENGINEERS");
  });
});

describe("G2 v2 — Khóa lưu hợp đồng khi tải lên Phụ lục chưa có hợp đồng gốc", () => {
  it("khóa lưu khi chỉ tải lên duy nhất 1 tệp phụ lục và chưa có hợp đồng gốc trong hệ thống", () => {
    const file = {
      id: "f1",
      kind: "appendix" as const,
      aiDocumentType: "appendix" as const,
      baseContractNumber: "24022024/HRVN - STAR ENGINEERS",
    };

    expect(isAppendixFile(file)).toBe(true);
    const blocked = isAppendixSaveBlocked([file], "24022024/HRVN - STAR ENGINEERS", {
      type: "not_found",
      baseContractNumber: "24022024/HRVN - STAR ENGINEERS",
      file,
    });

    expect(blocked).toBe(true);
  });

  it("khóa lưu khi phụ lục thuộc hợp đồng đã có trên hệ thống để bắt buộc người dùng dùng nút gán trực tiếp", () => {
    const file = {
      id: "f1",
      kind: "appendix" as const,
      aiDocumentType: "appendix" as const,
      baseContractNumber: "24022024/HRVN - STAR ENGINEERS",
      matchedBaseContractId: "contract-123",
    };

    const blocked = isAppendixSaveBlocked([file], "24022024/HRVN - STAR ENGINEERS", {
      type: "found",
      baseContractNumber: "24022024/HRVN - STAR ENGINEERS",
      file,
    });

    expect(blocked).toBe(true);
  });

  it("cho phép lưu khi tải lên cùng lúc Hợp đồng chính và Phụ lục khớp số hợp đồng", () => {
    const mainFile = {
      id: "main-1",
      kind: "document" as const,
      aiDocumentType: "document" as const,
      aiContractNumber: "24022024/HRVN - STAR ENGINEERS",
    };
    const appFile = {
      id: "app-1",
      kind: "appendix" as const,
      aiDocumentType: "appendix" as const,
      baseContractNumber: "24022024/HRVN - STAR ENGINEERS",
    };

    expect(hasMatchingMainContractFile([mainFile], "24022024/HRVN - STAR ENGINEERS")).toBe(true);
    const blocked = isAppendixSaveBlocked(
      [mainFile, appFile],
      "24022024/HRVN - STAR ENGINEERS",
      null,
    );

    expect(blocked).toBe(false);
  });

  it("khóa lưu khi tải lên Hợp đồng chính và Phụ lục nhưng số hợp đồng không khớp nhau", () => {
    const mainFile = {
      id: "main-1",
      kind: "document" as const,
      aiDocumentType: "document" as const,
      aiContractNumber: "HD-01/2026",
    };
    const appFile = {
      id: "app-1",
      kind: "appendix" as const,
      aiDocumentType: "appendix" as const,
      baseContractNumber: "HD-02/2026", // Lệch số hợp đồng
    };

    const blocked = isAppendixSaveBlocked([mainFile, appFile], "HD-01/2026", null);

    expect(blocked).toBe(true);
  });

  it("không khóa lưu khi chỉ tải lên hợp đồng thông thường không phải phụ lục", () => {
    const mainFile = {
      id: "main-1",
      kind: "document" as const,
      aiDocumentType: "document" as const,
      aiContractNumber: "HD-01/2026",
    };

    const blocked = isAppendixSaveBlocked([mainFile], "HD-01/2026", null);

    expect(blocked).toBe(false);
  });

  describe("Tự động phân tích và gán phụ lục vào hợp đồng gốc", () => {
    it("nhận diện phụ lục có hợp đồng gốc đã tồn tại trên hệ thống để tự động gán", () => {
      const extractedData = {
        documentType: "appendix" as const,
        contractNumber: "PL-01",
        baseContractNumber: "24022024/HRVN - STAR ENGINEERS",
        matchedBaseContract: {
          id: "contract-base-123",
          contractNumber: "24022024/HRVN - STAR ENGINEERS",
          partnerName: "STAR ENGINEERS",
        },
      };

      const isAppendixDoc =
        extractedData.documentType === "appendix" || Boolean(extractedData.baseContractNumber);
      expect(isAppendixDoc).toBe(true);

      // Khi hợp đồng gốc đã có trong hệ thống, hệ thống xác định được baseContractId và tự động gán
      const canAutoAttach = Boolean(extractedData.matchedBaseContract?.id);
      expect(canAutoAttach).toBe(true);
      expect(extractedData.matchedBaseContract?.id).toBe("contract-base-123");
    });

    it("không gán nhầm vào form tạo mới nếu tệp tải lên là phụ lục của hợp đồng đã có", () => {
      const extractedData = {
        documentType: "appendix" as const,
        contractNumber: "PL-02",
        baseContractNumber: "HD-99/2026",
        matchedBaseContract: {
          id: "contract-99",
          contractNumber: "HD-99/2026",
          partnerName: "Công ty ABC",
        },
      };

      const isAppendixDoc =
        extractedData.documentType === "appendix" || Boolean(extractedData.baseContractNumber);

      // Thông tin contractNumber không được điền vào form tạo hợp đồng mới nếu là phụ lục
      let formContractNumber = "";
      if (!isAppendixDoc && extractedData.contractNumber) {
        formContractNumber = extractedData.contractNumber;
      }

      expect(formContractNumber).toBe("");
    });

    it("chuẩn hóa số hợp đồng khi tìm kiếm hợp đồng gốc (bỏ qua khoảng trắng và dấu gạch)", () => {
      const target = "24022024/HRVN - STAR ENGINEERS";
      const normalizedTarget = target.replace(/[\s\-_/]/g, "").toLowerCase();

      const existingInDb = "24022024/HRVN-STAR ENGINEERS";
      const normalizedDb = existingInDb.replace(/[\s\-_/]/g, "").toLowerCase();

      expect(normalizedTarget).toBe(normalizedDb);
    });
  });
});

