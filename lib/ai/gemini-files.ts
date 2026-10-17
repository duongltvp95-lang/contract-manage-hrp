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
 * Upload 1 buffer lên Gemini Files API bằng multipart/resumable.
 *
 * Body multipart/related theo spec:
 * ```
 * --boundary
 * Content-Type: application/json; charset=UTF-8
 *
 * {"file": {"display_name": "filename.pdf"}}
 *
 * --boundary
 * Content-Type: application/pdf
 *
 * <bytes>
 * --boundary--
 * ```
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
}): Promise<ServiceResult<GeminiFile>> {
  if (!apiKey) {
    return err("validation", "Thiếu GEMINI_API_KEY khi upload file Gemini.");
  }
  if (!buffer || buffer.length === 0) {
    return err("validation", "Buffer rỗng — không thể upload lên Gemini Files.");
  }

  const boundary = `----GeminiBoundary${Date.now()}`;
  const metadata = JSON.stringify({ file: { display_name: filename } });

  // Build multipart body as Buffer (an toàn với mọi mime type, kể cả binary).
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n` +
      `\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n` +
      `\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat([head, buffer, tail]);

  const url = UPLOAD_URL;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "X-Goog-Upload-Protocol": "multipart",
        "x-goog-api-key": apiKey,
      },
      body,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      const message = errorPayload?.error?.message ?? `HTTP ${response.status}`;
      aiLog.error("Upload Gemini Files thất bại", {
        filename,
        sizeBytes: buffer.length,
        statusCode: response.status,
        errorMessage: message,
      });
      return err("validation", `Upload Gemini Files thất bại: ${message}`);
    }

    const result = (await response.json()) as {
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

    aiLog.info("Upload Gemini Files thành công", {
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
