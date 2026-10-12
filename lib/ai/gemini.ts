import "server-only";

import { ExtractedContractSchema, type ExtractedContract } from "@schemas/contract";
import { err, ok, type ServiceResult } from "@/lib/services/types";

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
  "gemini-3.5-flash",
];

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_AI_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const EXTRACTION_SYSTEM_PROMPT = `Bạn là trợ lý AI chuyên gia phân tích hợp đồng kinh tế và pháp lý tại Việt Nam.
Hãy đọc kỹ tài liệu hợp đồng đính kèm và trích xuất các thông tin sau thành JSON cấu trúc chuẩn:
- contractNumber: Số hợp đồng (chuỗi ký tự, ví dụ: "12/2026/HĐKT", để trống "" nếu không có)
- signedDate: Ngày ký hợp đồng theo định dạng chuẩn "YYYY-MM-DD" (ví dụ: "2026-03-15", để trống "" nếu không tìm thấy)
- expiryDate: Ngày hết hạn của hợp đồng theo định dạng chuẩn "YYYY-MM-DD" (ví dụ: "2027-03-15", để trống "" nếu không có hoặc không xác định)
- durationText: Thời hạn của hợp đồng ghi dạng chữ (ví dụ: "12 tháng", "2 năm", "Không xác định thời hạn", để trống "" nếu không có)
- partnerName: Tên đầy đủ của công ty hoặc pháp nhân đối tác (Bên B hoặc đối tác cung cấp/nhận dịch vụ)
- companyName: Tên công ty nội bộ (Bên A hoặc bên ký hợp đồng)
- summary: Tóm tắt ngắn gọn nội dung và phạm vi hợp đồng trong 1-2 câu tiếng Việt.

Chỉ trả về JSON hợp lệ khớp với cấu trúc trên.`;

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
 * Extracts contract metadata and parties from a file buffer using Google Gemini.
 */
export async function extractContractFromBuffer({
  buffer,
  mimeType,
  filename = "",
}: {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}): Promise<ServiceResult<ExtractedContract>> {
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
      "Dung lượng tệp vượt quá giới hạn 20 MB cho phép đối với phân tích AI.",
    );
  }

  const base64Data = buffer.toString("base64");
  let lastError = "Không thể kết nối tới dịch vụ AI Google Gemini.";

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: resolvedMime,
                data: base64Data,
              },
            },
            {
              text: EXTRACTION_SYSTEM_PROMPT,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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
          continue;
        }

        try {
          const cleanedText = cleanJsonText(rawText);
          const parsedJson = JSON.parse(cleanedText);
          const validated = ExtractedContractSchema.safeParse(parsedJson);

          if (!validated.success) {
            return ok({
              contractNumber: String(parsedJson.contractNumber ?? ""),
              signedDate: String(parsedJson.signedDate ?? ""),
              expiryDate: String(parsedJson.expiryDate ?? ""),
              durationText: String(parsedJson.durationText ?? ""),
              partnerName: String(parsedJson.partnerName ?? ""),
              companyName: String(parsedJson.companyName ?? ""),
              summary: String(parsedJson.summary ?? ""),
            });
          }

          return ok(validated.data);
        } catch (parseErr) {
          console.error(`[ai:gemini] Parse error on model ${model}:`, rawText, parseErr);
          continue;
        }
      }

      const errorPayload = (await response.json().catch(() => null)) as {
        error?: { message?: string; status?: string };
      } | null;

      lastError = errorPayload?.error?.message ?? `Lỗi HTTP ${response.status} từ Gemini API`;

      // If the model is 503 (high demand) or 404 (model unavailable) or 429, continue to next fallback model
      if (response.status === 503 || response.status === 404 || response.status === 429) {
        continue;
      }

      // Other client error (e.g. 400 or 401)
      return err("validation", `AI lỗi (${response.status}): ${lastError}`);
    } catch (networkError) {
      lastError = networkError instanceof Error ? networkError.message : "Lỗi kết nối mạng";
    }
  }

  return err("validation", `Trích xuất AI thất bại: ${lastError}`);
}
