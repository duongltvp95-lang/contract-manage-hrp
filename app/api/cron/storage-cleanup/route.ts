import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { processR2CleanupQueue } from "@/lib/services/storage-cleanup";

/**
 * Handles R2 storage cleanup outbox processing.
 *
 * Authentication:
 * 1. Bearer token in Authorization header matching process.env.CRON_SECRET (e.g., Vercel Cron, external runner).
 * 2. Authenticated user with role "admin".
 *
 * Any caller failing both checks is rejected with 401 Unauthorized.
 */
async function handleCleanup(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  const isBearerAuthorized =
    Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  let isAdminAuthorized = false;
  if (!isBearerAuthorized) {
    const user = await getCurrentUser();
    if (user?.role === "admin") {
      isAdminAuthorized = true;
    }
  }

  if (!isBearerAuthorized && !isAdminAuthorized) {
    return NextResponse.json(
      { error: "Unauthorized", code: "unauthorized" },
      { status: 401 },
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const limitParam = searchParams.get("limit");
  const limit = limitParam
    ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200)
    : 50;

  const result = await processR2CleanupQueue({ limit, maxAttempts: 5 });

  return NextResponse.json({
    success: true,
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
  });
}

export async function GET(request: NextRequest) {
  return handleCleanup(request);
}

export async function POST(request: NextRequest) {
  return handleCleanup(request);
}
