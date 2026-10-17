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
  extractContractFromBuffer,
  getGeminiModels,
  MAX_AI_FILE_SIZE_BYTES,
} from "@/lib/ai/gemini";
import { extractPdfText } from "@/lib/ai/pdf-text";

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
    it("gửi multipart/related với boundary đúng", async () => {
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

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://generativelanguage.googleapis.com/upload/v1beta/files");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("test-key");
      expect(headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);
      expect(headers["X-Goog-Upload-Protocol"]).toBe("multipart");
      // body phải chứa metadata JSON
      const body = init.body as Buffer;
      const bodyText = body.toString();
      expect(bodyText).toContain('"file"');
      expect(bodyText).toContain('"display_name":"test.pdf"');
      expect(bodyText).toContain("PDF bytes");
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

  it("từ chối tệp vượt quá 20 MB mà không gọi fetch", async () => {
    const hugeBuffer = Buffer.alloc(MAX_AI_FILE_SIZE_BYTES + 1);
    const result = await extractContractFromBuffer({
      buffer: hugeBuffer,
      mimeType: "application/pdf",
      filename: "huge.pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("20 MB");
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

  it("mặc định ưu tiên gemini-3.5-flash-lite ổn định", () => {
    delete process.env.GEMINI_MODEL;
    const models = getGeminiModels();
    expect(models[0]).toBe("gemini-3.5-flash-lite");
    expect(models).toContain("gemini-2.5-flash");
  });

  it("cấu hình GEMINI_MODEL ưu tiên model cấu hình mà không bị trùng lặp", () => {
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    const models = getGeminiModels();
    expect(models[0]).toBe("gemini-2.5-flash");
    // Không bị xuất hiện 2 lần
    expect(models.filter((m) => m === "gemini-2.5-flash")).toHaveLength(1);
    expect(models).toContain("gemini-3.5-flash-lite");
  });
});

describe("G2 v2 — extractPdfText (sửa BUG-1)", () => {
  it("trả null khi buffer rỗng", async () => {
    const result = await extractPdfText(Buffer.alloc(0));
    expect(result).toBeNull();
  });

  it("trả null khi buffer không phải PDF hợp lệ", async () => {
    const result = await extractPdfText(Buffer.from("not a pdf"));
    expect(result).toBeNull();
  });

  it("trả null khi buffer PDF scan (không có text layer)", async () => {
    // PDF tối thiểu không có text layer — chỉ có 1 object stream rỗng.
    const minimalPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000110 00000 n\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n178\n%%EOF",
    );
    const result = await extractPdfText(minimalPdf);
    // PDF này quá đơn giản, không có text layer → expect null
    expect(result).toBeNull();
  });
});
