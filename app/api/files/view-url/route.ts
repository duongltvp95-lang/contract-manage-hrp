import { NextResponse, type NextRequest } from "next/server";

import { ViewUrlRequestSchema } from "@schemas/file";

import { guardFileApiRequest, invalidJsonResponse, validationResponse } from "@/lib/api-guard";
import { getFileViewUrl } from "@/lib/services/files";
import { statusForCode } from "@/lib/services/types";

/**
 * POST /api/files/view-url — plan sections 59, 63, 64, 101.
 *
 * Issues a presigned GET for the in-app viewer. The file never passes through
 * Next.js; the browser fetches it straight from R2.
 *
 * R2 is private and RLS does not protect it (plan section 73), so this endpoint
 * is the only gate:
 *   - no session            -> 401
 *   - deactivated account   -> 403
 *   - too many requests     -> 429 (per user, see lib/rate-limit.ts)
 *   - another org's file    -> 403
 *   - a file id that does not exist -> 403 as well, so the response never
 *     reveals whether the id is real, and **no R2 URL is ever generated**
 *     (plan section 101).
 */
export async function POST(request: NextRequest) {
  const guard = await guardFileApiRequest("files:view-url");
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse();
  }

  const parsed = ViewUrlRequestSchema.safeParse(body);

  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  const result = await getFileViewUrl(
    parsed.data.fileId,
    guard.user.organizationId,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: statusForCode(result.code), headers: guard.headers },
    );
  }

  return NextResponse.json(result.data, { status: 200, headers: guard.headers });
}
