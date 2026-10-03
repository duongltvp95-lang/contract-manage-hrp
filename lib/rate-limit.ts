import "server-only";

import { createClient } from "@/lib/supabase/server";
import { dbError, ok, type ServiceResult } from "@/lib/services/types";
import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
  type RateLimitBucket,
  type RateLimitVerdict,
} from "@/lib/rate-limit-policy";

/**
 * Per-user rate limiting for the file API routes — W1-WEB-041.
 *
 * The counter lives in PostgreSQL (see
 * `supabase/migrations/20261003110000_add_rate_limit.sql`), because Vercel
 * serverless instances are ephemeral and horizontally scaled: an in-process
 * counter would let a burst through by landing on different instances.
 *
 * The user id is resolved inside the SQL function from `auth.uid()`. This module
 * never passes it, so a caller can only ever spend their own quota.
 *
 * The pure parts live in `lib/rate-limit-policy.ts`.
 */

export {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
  rateLimitBody,
  rateLimitHeaders,
  rateLimitMessage,
  retryAfterSeconds,
  type RateLimitBucket,
  type RateLimitVerdict,
} from "@/lib/rate-limit-policy";

type RpcRow = {
  allowed: boolean | null;
  remaining: number | null;
  reset_at: string | null;
};

export async function consumeRateLimit(
  bucket: RateLimitBucket,
): Promise<ServiceResult<RateLimitVerdict>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_limit: RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });

  if (error) {
    return dbError("consumeRateLimit", error);
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined;

  if (!row) {
    return dbError("consumeRateLimit", "consume_rate_limit returned no row");
  }

  return ok({
    allowed: row.allowed === true,
    limit: RATE_LIMIT_MAX_REQUESTS,
    remaining: Math.max(0, Number(row.remaining ?? 0)),
    resetAt: row.reset_at ?? new Date().toISOString(),
  });
}
