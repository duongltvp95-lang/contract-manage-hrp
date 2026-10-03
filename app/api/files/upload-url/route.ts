import { NextResponse, type NextRequest } from "next/server";

import { UploadUrlRequestSchema } from "@schemas/file";

import { guardFileApiRequest, invalidJsonResponse, validationResponse } from "@/lib/api-guard";
import { createUploadRequest } from "@/lib/services/files";
import { statusForCode } from "@/lib/services/types";

/**
 * POST /api/files/upload-url — plan sections 42, 64, 77.
 *
 * The browser asks for one presigned PUT per file, uploads straight to R2, then
 * calls the `completeUpload` server action to persist the row.
 *
 * Authorization happens before any URL exists:
 *   session -> rate limit -> organization -> contract belongs to that organization.
 * A contract from another organization is answered with 403 and no URL.
 *
 * `organizationId` is never read from the request body.
 */
export async function POST(request: NextRequest) {
  const guard = await guardFileApiRequest("files:upload-url");
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse();
  }

  const parsed = UploadUrlRequestSchema.safeParse(body);

  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  const result = await createUploadRequest({
    // authoritative, from the session
    organizationId: guard.user.organizationId,
    contractId: parsed.data.contractId,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    fileSize: parsed.data.fileSize,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code, issues: result.issues },
      { status: statusForCode(result.code), headers: guard.headers },
    );
  }

  return NextResponse.json(result.data, { status: 200, headers: guard.headers });
}
