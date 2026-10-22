import "server-only";

import { NextResponse } from "next/server";

import { resolveAccess, type CurrentUser } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  rateLimitBody,
  rateLimitHeaders,
  retryAfterSeconds,
  type RateLimitBucket,
} from "@/lib/rate-limit-policy";

/**
 * The shared preamble for the two file API routes — plan sections 64, 101.
 *
 * Both endpoints had the same eight lines of session handling and the same
 * response shapes; keeping them in one place means a new file route cannot
 * forget either the authorization or the rate limit.
 *
 * Order matters: the session is checked **before** the counter is touched, so an
 * unauthenticated caller can neither reach the endpoint nor consume anyone's
 * quota.
 */

export type ApiGuard =
  | { ok: true; user: CurrentUser; headers: Record<string, string> }
  | { ok: false; response: NextResponse };

export async function guardFileApiRequest(
  bucket: RateLimitBucket,
): Promise<ApiGuard> {
  let access: Awaited<ReturnType<typeof resolveAccess>>;
  try {
    access = await resolveAccess({ abortSignal: AbortSignal.timeout(5_000) });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("AbortError"))) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Dịch vụ xác thực tạm thời chậm, vui lòng thử lại.", code: "timeout" },
          { status: 503 },
        ),
      };
    }
    throw error;
  }

  if (access.status !== "ok") {
    const disabled = access.status === "disabled";

    return {
      ok: false,
      response: NextResponse.json(
        {
          error: disabled ? "Tài khoản đã bị vô hiệu hoá" : "Bạn cần đăng nhập",
          code: disabled ? "forbidden" : "unauthenticated",
        },
        { status: disabled ? 403 : 401 },
      ),
    };
  }

  const verdict = await consumeRateLimit(bucket, { abortSignal: AbortSignal.timeout(5_000) });

  if (!verdict.ok) {
    // Fail CLOSED.
    //
    // For presigned URL generation endpoints (such as /api/ai/upload-url),
    // subsequent steps do not necessarily hit PostgreSQL. Failing open would allow
    // unmetered issuance of presigned R2 upload URLs during a database blip.
    console.error(
      `[rate-limit] counter unavailable for ${bucket}; failing closed`,
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Dịch vụ giới hạn tần suất tạm thời không khả dụng, vui lòng thử lại sau.",
          code: "rate_limit_unavailable",
        },
        { status: 503 },
      ),
    };
  }

  const headers = rateLimitHeaders(verdict.data);

  if (!verdict.data.allowed) {
    return {
      ok: false,
      response: NextResponse.json(rateLimitBody(verdict.data), {
        status: 429,
        headers: {
          ...headers,
          "Retry-After": String(retryAfterSeconds(verdict.data)),
        },
      }),
    };
  }

  return { ok: true, user: access.user, headers };
}

/** Invalid JSON body — both routes answer identically. */
export function invalidJsonResponse(): NextResponse {
  return NextResponse.json(
    { error: "Body phải là JSON hợp lệ", code: "validation" },
    { status: 422 },
  );
}

/** A Zod failure, with the per-field issues the client form can highlight. */
export function validationResponse(
  error: { issues: { path: PropertyKey[]; message: string }[] },
): NextResponse {
  return NextResponse.json(
    {
      error: "Yêu cầu không hợp lệ",
      code: "validation",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 422 },
  );
}
