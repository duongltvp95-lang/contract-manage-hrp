import { NextResponse, type NextRequest } from "next/server";

import { CompleteUploadSchema } from "@schemas/file";

import { resolveAccess } from "@/lib/auth";
import { completeUpload } from "@/lib/services/files";
import { statusForCode } from "@/lib/services/types";

/**
 * TEST FIXTURE — not part of the application.
 *
 * `completeUpload()` is reachable from the browser only as a server action, and
 * only after a file the browser itself measured. That makes the interesting case
 * — a client that declares a small file and uploads a large one — impossible to
 * reach through the UI, which is exactly why the check needs a direct route to
 * exercise it.
 *
 * This file lives under `tests/` and is copied into `app/api/hardening-probe/`
 * by `tests/integration/global-setup.ts` for the duration of the integration
 * run, then removed. It is never part of a production build, and it answers 404
 * unless `HARDENING_PROBE=1` is set in the server process.
 *
 * The organization and user come from the session, exactly as the real server
 * action does — the request body cannot choose a tenant.
 */
export async function POST(request: NextRequest) {
  if (process.env.HARDENING_PROBE !== "1" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const access = await resolveAccess();
  if (access.status !== "ok") {
    return NextResponse.json(
      { error: "unauthenticated", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const parsed = CompleteUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", code: "validation" },
      { status: 422 },
    );
  }

  const result = await completeUpload({
    organizationId: access.user.organizationId,
    userId: access.user.id,
    contractId: parsed.data.contractId,
    fileId: parsed.data.fileId,
    objectKey: parsed.data.objectKey,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    fileSize: parsed.data.fileSize,
  });

  return result.ok
    ? NextResponse.json(result.data, { status: 200 })
    : NextResponse.json(
        { error: result.message, code: result.code },
        { status: statusForCode(result.code) },
      );
}
