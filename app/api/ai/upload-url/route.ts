import { NextResponse, type NextRequest } from "next/server";

export const maxDuration = 60;
import { guardFileApiRequest } from "@/lib/api-guard";
import { createUploadUrl } from "@/lib/r2/presign";
import {
  ALLOWED_MIME_TYPES,
  MAX_AI_FILE_SIZE_BYTES,
  resolveMimeType,
} from "@/lib/ai/gemini";

/**
 * POST /api/ai/upload-url
 * Issues a presigned PUT URL directly to Cloudflare R2 for AI document analysis.
 * Bypasses Vercel's 4.5 MB request payload limit completely.
 * Protected with authentication, account status check, and rate limiting.
 */
export async function POST(request: NextRequest) {
  const guard = await guardFileApiRequest("ai:upload-url");
  if (!guard.ok) return guard.response;

  let body: { filename?: string; mimeType?: string; fileSize?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Dữ liệu JSON không hợp lệ" }, { status: 400 });
  }

  const filename = (body.filename ?? "document.pdf").trim();
  const fileSize = Number(body.fileSize) || 0;
  const resolvedMime = resolveMimeType(filename, body.mimeType);

  if (!ALLOWED_MIME_TYPES.has(resolvedMime)) {
    return NextResponse.json(
      {
        error: `Định dạng tệp (${resolvedMime || "không rõ"}) chưa được hỗ trợ. AI chỉ hỗ trợ PDF hoặc hình ảnh (PNG, JPG, WebP).`,
      },
      { status: 400 },
    );
  }

  if (fileSize <= 0) {
    return NextResponse.json(
      { error: "Kích thước tệp không hợp lệ." },
      { status: 400 },
    );
  }

  if (fileSize > MAX_AI_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Dung lượng tệp vượt quá giới hạn 20 MB cho phép đối với phân tích AI." },
      { status: 400 },
    );
  }

  const fileId = crypto.randomUUID();
  const safeFilename = filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const objectKey = `ai-temp/${guard.user.organizationId}/${fileId}/${safeFilename}`;

  try {
    const uploadUrl = await createUploadUrl(objectKey, resolvedMime, fileSize);
    return NextResponse.json(
      { uploadUrl, objectKey, mimeType: resolvedMime },
      { status: 200, headers: guard.headers },
    );
  } catch (error) {
    console.error("[api:ai/upload-url] presign error:", error);
    return NextResponse.json(
      { error: "Không thể tạo URL tải lên cho AI." },
      { status: 500 },
    );
  }
}
