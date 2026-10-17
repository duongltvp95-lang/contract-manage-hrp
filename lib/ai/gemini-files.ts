import "server-only";

/**
 * Gemini Files API — upload 1 file lần, dùng `fileData.fileUri` nhiều lần.
 *
 * Tham khảo:
 * - https://ai.google.dev/api/files
 * - https://ai.google.dev/api/files#file_uploads
 *
 * Khác với inlineData base64 (gửi bytes mỗi request), Files API:
 * - Upload 1 lần → server Gemini trả `name` ("files/abc") và `uri` (https URL).
 * - Sau đó `generateContent` chỉ cần gửi `fileData: { mimeType, fileUri }` → body vài KB.
 * - File có TTL 48h → PHẢI xoá sau khi extract xong (1 request DELETE).
 *
 * Lưu ý:
 * - Module này có `server-only` → chỉ dùng ở server action / route handler.
 * - Upload dùng `multipart/related` (KHÔNG phải `multipart/form-data`).
 * - Theo rule §2 workspace: KHÔNG log giá trị `apiKey`; chỉ log tên biến.
 */

import { ok, err, type ServiceResult } from "@/lib/services/types";
import { aiLog } from "@/lib/ai/log";

const UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const FILES_URL = "https://generativelanguage.googleapis.com/v1beta/files";

/** Thời gian timeout cho upload (15s) — ngân sách an toàn dưới giới hạn 60s của Vercel. */
const UPLOAD_TIMEOUT_MS = 15_000;
/** Thời gian timeout cho delete (3s) — thao tác dọn dẹp nhẹ, không chặn lâu. */
const DELETE_TIMEOUT_MS = 3_000;

export type GeminiFile = {
  name: string; // "files/abc123"
  uri: string; // https://... dùng trong fileData.fileUri
  mimeType: string;
  sizeBytes: number;
};

/**
 * Upload 1 buffer lên Gemini Files API bằng quy trình Resumable Upload chính thức của Google:
 * 1. POST tới /upload/v1beta/files với X-Goog-Upload-Protocol: resumable, Command: start
 *    -> Google trả về URL upload trong header `x-goog-upload-url`.
 * 2. POST trực tiếp nhị phân lên URL nhận được với X-Goog-Upload-Command: upload, finalize.
 *
 * Tham khảo chính thức: https://ai.google.dev/gemini-api/docs/files
 */
export async function uploadToGeminiFiles({
  buffer,
  mimeType,
  filename,
  apiKey,
  timeoutMs = UPLOAD_TIMEOUT_MS,
}: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<ServiceResult<GeminiFile>> {
  if (!apiKey) {
    return err("validation", "Thiếu GEMINI_API_KEY khi upload file Gemini.");
  }
  if (!buffer || buffer.length === 0) {
    return err("validation", "Buffer rỗng — không thể upload lên Gemini Files.");
  }

  const effectiveTimeout = Math.min(UPLOAD_TIMEOUT_MS, timeoutMs);
  const startTimeout = Math.min(6_000, effectiveTimeout);
  const uploadTimeout = Math.max(4_000, effectiveTimeout - 4_000);

  try {
    // Bước 1: Khởi tạo phiên upload (resumable start)
    const initResponse = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(buffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ file: { display_name: filename } }),
      signal: AbortSignal.timeout(startTimeout),
    });

    if (!initResponse.ok) {
      const errorPayload = (await initResponse.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      const message = errorPayload?.error?.message ?? `HTTP ${initResponse.status}`;
      aiLog.error("Khởi tạo upload Gemini Files thất bại", {
        filename,
        sizeBytes: buffer.length,
        statusCode: initResponse.status,
        errorMessage: message,
      });
      return err("validation", `Khởi tạo upload Gemini Files thất bại: ${message}`);
    }

    const uploadUrl = initResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      aiLog.error("Gemini Files không trả về x-goog-upload-url", { filename });
      return err("validation", "Gemini Files không trả về URL tải lên resumable.");
    }

    // Bước 2: Tải dữ liệu nhị phân lên upload URL và finalize
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Length": String(buffer.length),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(uploadTimeout),
    });

    if (!uploadResponse.ok) {
      const errorPayload = (await uploadResponse.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      const message = errorPayload?.error?.message ?? `HTTP ${uploadResponse.status}`;
      aiLog.error("Upload dữ liệu Gemini Files thất bại", {
        filename,
        sizeBytes: buffer.length,
        statusCode: uploadResponse.status,
        errorMessage: message,
      });
      return err("validation", `Upload dữ liệu Gemini Files thất bại: ${message}`);
    }

    const result = (await uploadResponse.json()) as {
      file?: { name?: string; uri?: string; mimeType?: string; sizeBytes?: string };
    };

    if (!result.file?.name || !result.file?.uri) {
      aiLog.error("Gemini Files response thiếu name/uri", {
        filename,
        responseKeys: Object.keys(result),
      });
      return err("validation", "Gemini Files response không hợp lệ (thiếu name/uri).");
    }

    const file: GeminiFile = {
      name: result.file.name,
      uri: result.file.uri,
      mimeType: result.file.mimeType ?? mimeType,
      sizeBytes: Number(result.file.sizeBytes ?? buffer.length),
    };

    aiLog.info("Upload Gemini Files thành công (resumable)", {
      filename,
      geminiFileName: file.name,
      sizeBytes: file.sizeBytes,
    });

    return ok(file);
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Lỗi không xác định";
    aiLog.error("Upload Gemini Files ngoại lệ", {
      filename,
      errorMessage,
    });
    return err("validation", `Upload Gemini Files ngoại lệ: ${errorMessage}`);
  }
}

/**
 * Xoá 1 file đã upload lên Gemini. Best-effort: lỗi chỉ warn, không throw.
 * File Gemini có TTL 48h nên cần xoá ngay sau khi extract xong để tránh tốn quota.
 */
export async function deleteGeminiFile(
  fileName: string,
  apiKey: string,
): Promise<void> {
  if (!fileName || !apiKey) return;
  const url = `${FILES_URL}/${fileName}`;
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      aiLog.warn("Delete Gemini File không thành công", {
        geminiFileName: fileName,
        statusCode: response.status,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    aiLog.warn("Delete Gemini File ngoại lệ", {
      geminiFileName: fileName,
      errorMessage,
    });
  }
}
