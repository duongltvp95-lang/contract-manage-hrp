import "server-only";

import { type ExtractedContract } from "@schemas/contract";
import { MAX_AI_FILE_SIZE_BYTES, MAX_AI_FILE_SIZE_MB } from "@schemas/file";
import { err, ok, type ServiceResult } from "@/lib/services/types";
import { normalizeDurationText } from "@/lib/ai/matching";
import { aiLog } from "@/lib/ai/log";

export function getGeminiModels(): string[] {
  const envModel = process.env.GEMINI_MODEL?.trim();
  const defaults = [
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
  ];
  if (envModel) {
    return [envModel, ...defaults.filter((m) => m !== envModel)];
  }
  return defaults;
}

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export { MAX_AI_FILE_SIZE_BYTES, MAX_AI_FILE_SIZE_MB };

const EXTRACTION_SYSTEM_PROMPT = `Bạn là trợ lý AI chuyên gia phân tích hợp đồng kinh tế và pháp lý tại Việt Nam.
Hãy đọc kỹ tài liệu hợp đồng đính kèm và trích xuất các thông tin sau thành JSON cấu trúc chuẩn:
- contractNumber: Số hợp đồng (chuỗi ký tự, ví dụ: "12/2026/HĐKT", để trống "" nếu không có)
- signedDate: Ngày ký hợp đồng theo định dạng chuẩn "YYYY-MM-DD" (ví dụ: "2026-03-15", để trống "" nếu không tìm thấy)
- expiryDate: Ngày hết hạn của hợp đồng theo định dạng chuẩn "YYYY-MM-DD" (ví dụ: "2027-03-15", để trống "" nếu không có hoặc không xác định)
- durationText: Thời hạn hiệu lực của hợp đồng ghi dạng khoảng thời gian như số tháng hoặc số năm (ví dụ: "6 tháng", "1 năm", "2 năm", "3 năm", "Không xác định thời hạn", để trống "" nếu không có).
  QUY TẮC BẮT BUỘC VỀ THỜI HẠN:
  + TUYỆT ĐỐI KHÔNG ghi dạng khoảng ngày "Từ ngày ... đến ngày ..." hay ngày tháng cụ thể vào trường này.
  + Nếu hợp đồng chỉ ghi khoảng ngày bắt đầu và kết thúc (ví dụ: từ ngày 20/12/2025 đến ngày 20/12/2026), bạn PHẢI tự tính toán và quy đổi ra số tháng hoặc số năm tương ứng (ví dụ: tròn 12 tháng -> "1 năm", 24 tháng -> "2 năm", 6 tháng -> "6 tháng").
  + Chuẩn hóa cách ghi: 12 tháng -> "1 năm", 24 tháng -> "2 năm", 36 tháng -> "3 năm", "01 năm" -> "1 năm", "02 năm" -> "2 năm".
- companyName: Tên công ty nội bộ của chúng tôi (dù hợp đồng ghi là Bên A hay Bên B).
  QUY TẮC QUAN TRỌNG: Chúng tôi có 2 công ty nội bộ trên hệ thống:
  1) "CÔNG TY TNHH HRP VIỆT NAM" (quy ước viết tắt là HRP)
  2) "CÔNG TY TNHH HR PARTNER VIỆT NAM" (quy ước viết tắt là HR VN)
  Bất kể hợp đồng ghi công ty của chúng tôi là Bên A hay Bên B, hãy điền tên công ty của chúng tôi vào "companyName". TUYỆT ĐỐI KHÔNG ĐIỀN VÀO "partnerName"!
- partnerName: Tên công ty/pháp nhân ĐỐI TÁC BÊN NGOÀI (bên còn lại trong hợp đồng giao dịch với công ty của chúng tôi, dù là Bên A hay Bên B). TUYỆT ĐỐI KHÔNG điền HRP, HRP Việt Nam, HR VN hay HR Partner Việt Nam vào đây.
- partnerTaxCode: Mã số thuế của ĐỐI TÁC BÊN NGOÀI nếu có trong hợp đồng (chuỗi số, ví dụ: "0101234567", để trống "" nếu không có)
- partnerAddress: Địa chỉ trụ sở của ĐỐI TÁC BÊN NGOÀI nếu có trong hợp đồng (để trống "" nếu không có)
- summary: Tóm tắt ngắn gọn nội dung và phạm vi hợp đồng trong 1-2 câu tiếng Việt.

Chỉ trả về JSON hợp lệ khớp với cấu trúc trên.`;

const CONTRACT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    contractNumber: {
      type: "STRING",
      description: "Số hợp đồng, để trống '' nếu không có",
    },
    signedDate: {
      type: "STRING",
      description: "Ngày ký hợp đồng YYYY-MM-DD, để trống '' nếu không tìm thấy",
    },
    expiryDate: {
      type: "STRING",
      description: "Ngày hết hạn hợp đồng YYYY-MM-DD, để trống '' nếu không có",
    },
    durationText: {
      type: "STRING",
      description: "Thời hạn hiệu lực ghi dạng số tháng hoặc số năm (vd '1 năm', '6 tháng')",
    },
    companyName: {
      type: "STRING",
      description: "Tên công ty nội bộ: 'CÔNG TY TNHH HRP VIỆT NAM' hoặc 'CÔNG TY TNHH HR PARTNER VIỆT NAM'",
    },
    partnerName: {
      type: "STRING",
      description: "Tên công ty đối tác bên ngoài",
    },
    partnerTaxCode: {
      type: "STRING",
      description: "Mã số thuế của đối tác bên ngoài",
    },
    partnerAddress: {
      type: "STRING",
      description: "Địa chỉ của đối tác bên ngoài",
    },
    summary: {
      type: "STRING",
      description: "Tóm tắt ngắn gọn nội dung và phạm vi hợp đồng trong 1-2 câu",
    },
  },
  required: [
    "contractNumber",
    "signedDate",
    "expiryDate",
    "durationText",
    "companyName",
    "partnerName",
    "summary",
  ],
};

/**
 * Safely strips markdown code blocks and extracts JSON object substring.
 */
export function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

/**
 * Resolves accurate mime type using filename extension as fallback.
 */
export function resolveMimeType(filename: string, mimeType?: string): string {
  const cleanMime = mimeType?.toLowerCase().trim();
  if (cleanMime && ALLOWED_MIME_TYPES.has(cleanMime)) {
    return cleanMime;
  }
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return cleanMime || "application/octet-stream";
}

/**
 * Normalizes various date string formats (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY)
 * to standard ISO YYYY-MM-DD accepted by HTML date inputs and database date fields.
 */
export function normalizeDateToIso(dateStr?: string): string {
  if (!dateStr) return "";
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === trimmed
      ? trimmed
      : "";
  }
  const viMatch = trimmed.match(/ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i);
  if (viMatch) {
    const day = viMatch[1].padStart(2, "0");
    const month = viMatch[2].padStart(2, "0");
    const year = viMatch[3];
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate
      ? candidate
      : "";
  }
  const dmyMatch = trimmed.match(/^(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate
      ? candidate
      : "";
  }
  const ymdMatch = trimmed.match(/^(\d{4})[/\.-](\d{1,2})[/\.-](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate
      ? candidate
      : "";
  }
  return "";
}

/**
 * Extracts contract metadata and parties from a file buffer using Google Gemini.
 *
 * Hỗ trợ 2 luồng (G2 v2):
 * 1. `geminiFileName` + `geminiFileUri` (ưu tiên) — dùng `fileData`, body nhỏ.
 * 2. Buffer truyền thống — dùng `inlineData` base64 (fallback cho test/dev không có Files API).
 */
export async function extractContractFromBuffer({
  buffer,
  mimeType,
  filename = "",
  geminiFileName,
  geminiFileUri,
  remainingBudgetMs = 32_000,
}: {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
  /** Optional: tên file đã upload lên Gemini Files API (vd "files/abc123") */
  geminiFileName?: string;
  /** Optional: URI của file đã upload (dùng trong fileData.fileUri) */
  geminiFileUri?: string;
  /** Ngân sách thời gian tối đa còn lại cho bước extract (ms) */
  remainingBudgetMs?: number;
}): Promise<ServiceResult<ExtractedContract>> {
  const extractStartTime = Date.now();
  const extractDeadline = extractStartTime + remainingBudgetMs;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return err(
      "validation",
      "Chưa cấu hình GEMINI_API_KEY trên máy chủ (Vercel). Vui lòng thêm biến môi trường GEMINI_API_KEY vào Project Settings trên Vercel.",
    );
  }

  const resolvedMime = resolveMimeType(filename, mimeType);

  if (!ALLOWED_MIME_TYPES.has(resolvedMime)) {
    return err(
      "validation",
      `Định dạng tệp (${resolvedMime || "không rõ"}) chưa được hỗ trợ. AI chỉ hỗ trợ phân tích PDF hoặc hình ảnh (PNG, JPG, WebP).`,
    );
  }

  if (buffer.length > MAX_AI_FILE_SIZE_BYTES) {
    return err(
      "validation",
      `Dung lượng tệp vượt quá giới hạn ${MAX_AI_FILE_SIZE_MB} MB cho phép đối với phân tích AI.`,
    );
  }

  // Quyết định luồng xử lý:
  // - Có geminiFileName/Uri (G2 v2 — Files API) → dùng fileData, body vài KB.
  // - Không có → thử trích text từ PDF (BUG-1 sửa); nếu fail → fallback base64.
  const useFilesApi = Boolean(geminiFileName && geminiFileUri);

  let base64Data: string | null = null;
  let pdfTextForModel: string | null = null;

  if (!useFilesApi && resolvedMime === "application/pdf") {
    try {
      // Dành tối thiểu 6s cho bước gọi model Gemini phía sau
      const remainingBeforePdf = extractDeadline - Date.now() - 6_000;
      if (remainingBeforePdf >= 2_000) {
        const { extractPdfText } = await import("@/lib/ai/pdf-text");
        const pdfTimeout = Math.min(8_000, remainingBeforePdf);
        const pdfResult = await extractPdfText(buffer, pdfTimeout);
        if (pdfResult) {
          pdfTextForModel = pdfResult.text;
        }
      }
    } catch {
      // PDF.js lỗi → fallback xuống luồng base64
    }
  }

  if (!useFilesApi && !pdfTextForModel) {
    base64Data = buffer.toString("base64");
  }

  let lastError = "Không thể kết nối tới dịch vụ AI Google Gemini.";

  // Thử tối đa các models trong danh sách nếu ngân sách thời gian thực tế vẫn còn đủ
  const models = getGeminiModels().slice(0, 3);

  for (const model of models) {
    const remainingTime = extractDeadline - Date.now();

    // Nếu thời gian còn lại dưới 6 giây, dừng ngay để không vượt quá giới hạn 60s của Vercel
    if (remainingTime < 6_000) {
      aiLog.warn("Hết ngân sách thời gian trích xuất AI, dừng fallback", {
        model,
        elapsedSoFar: Date.now() - extractStartTime,
        remainingBudgetMs,
      });
      lastError = "Quá thời gian thực thi cho phép. Vui lòng bấm trích xuất lại hoặc sử dụng tệp tài liệu ngắn hơn.";
      break;
    }

    const modelTimeoutMs = Math.min(15_000, remainingTime);
    const startTime = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // Build parts dựa trên luồng đã chọn.
    const parts: Array<Record<string, unknown>> = [];

    if (useFilesApi) {
      // Files API: chỉ cần fileData + prompt. Body vài KB.
      parts.push({
        fileData: {
          mimeType: resolvedMime,
          fileUri: geminiFileUri,
        },
      });
      parts.push({ text: EXTRACTION_SYSTEM_PROMPT });
    } else if (pdfTextForModel) {
      // PDF có text layer: gửi văn bản thuần kèm system prompt đầy đủ.
      parts.push({
        text: `Đây là nội dung văn bản được trích xuất từ tài liệu PDF:\n\n${pdfTextForModel}\n\n---\nYêu cầu trích xuất thông tin từ nội dung trên:`,
      });
      parts.push({ text: EXTRACTION_SYSTEM_PROMPT });
    } else {
      // Fallback: gửi base64 (ảnh hoặc PDF scan).
      parts.push({
        inlineData: {
          mimeType: resolvedMime,
          data: base64Data!,
        },
      });
      parts.push({ text: EXTRACTION_SYSTEM_PROMPT });
    }

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: CONTRACT_RESPONSE_SCHEMA,
      },
    };

    try {
      aiLog.info("Đang trích xuất với model", {
        model,
        useFilesApi,
        modelTimeoutMs,
        elapsedMs: Date.now() - startTime,
      });
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(modelTimeoutMs),
      });

      if (response.ok) {
        const result = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };

        const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          aiLog.warn("Model trả về nội dung rỗng", {
            model,
            elapsedMs: Date.now() - startTime,
          });
          continue;
        }

        try {
          const cleanedText = cleanJsonText(rawText);
          const parsedJson = (JSON.parse(cleanedText) ?? {}) as Record<string, unknown>;

          const signedIso = normalizeDateToIso(String(parsedJson.signedDate ?? ""));
          const expiryIso = normalizeDateToIso(String(parsedJson.expiryDate ?? ""));
          const normalizedDuration = normalizeDurationText({
            durationText: String(parsedJson.durationText ?? "").trim(),
            signedDate: signedIso,
            expiryDate: expiryIso,
          });

          const extracted: ExtractedContract = {
            contractNumber: String(parsedJson.contractNumber ?? "").trim(),
            signedDate: signedIso,
            expiryDate: expiryIso,
            durationText: normalizedDuration,
            partnerName: String(parsedJson.partnerName ?? "").trim(),
            partnerTaxCode: String(parsedJson.partnerTaxCode ?? "").trim(),
            partnerAddress: String(parsedJson.partnerAddress ?? "").trim(),
            companyName: String(parsedJson.companyName ?? "").trim(),
            summary: String(parsedJson.summary ?? "").trim(),
          };

          aiLog.info("Trích xuất thành công", {
            model,
            elapsedMs: Date.now() - startTime,
            useFilesApi,
          });
          return ok(extracted);
        } catch (parseErr) {
          aiLog.error("Parse JSON thất bại", {
            model,
            rawTextLength: rawText.length,
            errorMessage: String(parseErr),
          });
          continue;
        }
      }

      const errorPayload = (await response.json().catch(() => null)) as {
        error?: { message?: string; status?: string };
      } | null;

      lastError = errorPayload?.error?.message ?? `Lỗi HTTP ${response.status} từ Gemini API`;

      // If the model is 503 (high demand) or 404 (model unavailable) or 429, continue to next fallback model
      if (response.status === 503 || response.status === 404 || response.status === 429) {
        aiLog.warn("Model gặp lỗi HTTP, chuyển fallback", {
          model,
          statusCode: response.status,
          lastError,
          elapsedMs: Date.now() - startTime,
        });
        continue;
      }

      // Other client error (e.g. 400 or 401)
      return err("validation", `AI lỗi (${response.status}): ${lastError}`);
    } catch (networkError) {
      const isTimeout =
        networkError instanceof Error &&
        (networkError.name === "TimeoutError" || networkError.message.includes("timeout"));
      lastError = isTimeout
        ? `Quá thời gian chờ phản hồi (${Math.round(modelTimeoutMs / 1000)}s) từ model ${model}`
        : networkError instanceof Error
          ? networkError.message
          : "Lỗi kết nối mạng";
      aiLog.warn("Model gặp lỗi mạng, chuyển fallback", {
        model,
        lastError,
        elapsedMs: Date.now() - startTime,
      });
    }
  }

  const friendlyError = lastError.toLowerCase().includes("high demand")
    ? "Hệ thống Google Gemini hiện đang quá tải truy vấn tạm thời. Bạn vui lòng bấm nút trích xuất lại sau vài giây."
    : lastError;

  return err("validation", `Trích xuất AI thất bại: ${friendlyError}`);
}
