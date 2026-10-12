import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/server-action";
import { createUploadUrl } from "@/lib/r2/presign";
import { resolveMimeType } from "@/lib/ai/gemini";

const MAX_AI_TEMP_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * POST /api/ai/upload-url
 * Issues a presigned PUT URL directly to Cloudflare R2 for AI document analysis.
 * Bypasses Vercel's 4.5 MB request payload limit completely.
 */
export async function POST(request: NextRequest) {
  const access = await authorized();
  if (!access.ok) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let body: { filename?: string; mimeType?: string; fileSize?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Dữ liệu JSON không hợp lệ" }, { status: 400 });
  }

  const filename = (body.filename ?? "document.pdf").trim();
  const fileSize = Number(body.fileSize) || 0;
  const resolvedMime = resolveMimeType(filename, body.mimeType);

  if (fileSize > MAX_AI_TEMP_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Dung lượng tệp vượt quá giới hạn 25 MB cho phép đối với phân tích AI." },
      { status: 400 },
    );
  }

  const fileId = crypto.randomUUID();
  const safeFilename = filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const objectKey = `ai-temp/${access.user.organizationId}/${fileId}/${safeFilename}`;

  try {
    const uploadUrl = await createUploadUrl(objectKey, resolvedMime);
    return NextResponse.json({ uploadUrl, objectKey }, { status: 200 });
  } catch (error) {
    console.error("[api:ai/upload-url] presign error:", error);
    return NextResponse.json(
      { error: "Không thể tạo URL tải lên cho AI." },
      { status: 500 },
    );
  }
}
