/**
 * Rate limit policy — pure, no `server-only`, no Next.js, no I/O.
 *
 * Split out from `lib/rate-limit.ts` (plan section 75 pattern: pure rules in one
 * place, the database call in another) so the arithmetic and the response
 * wording are unit-testable without a Supabase connection.
 */

export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMIT_MAX_REQUESTS = 60;

/** Separate per-user budgets; expensive model calls have a much tighter limit. */
export const RATE_LIMIT_POLICIES = {
  "files:upload-url": { maxRequests: 60 },
  "files:view-url": { maxRequests: 60 },
  "ai:upload-url": { maxRequests: 60 },
  "ai:extract": { maxRequests: 10 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMIT_POLICIES;

export type RateLimitVerdict = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
};

export function getRateLimitPolicy(bucket: RateLimitBucket) {
  return RATE_LIMIT_POLICIES[bucket];
}

/** Standard `X-RateLimit-*` headers, sent on success and on 429 alike. */
export function rateLimitHeaders(
  verdict: RateLimitVerdict,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(verdict.limit),
    "X-RateLimit-Remaining": String(verdict.remaining),
    "X-RateLimit-Reset": verdict.resetAt,
  };
}

/** Whole seconds until the window resets, never below 1 (RFC 9110 Retry-After). */
export function retryAfterSeconds(
  verdict: RateLimitVerdict,
  now: number = Date.now(),
): number {
  const reset = Date.parse(verdict.resetAt);
  if (Number.isNaN(reset)) return RATE_LIMIT_WINDOW_SECONDS;
  return Math.max(1, Math.ceil((reset - now) / 1000));
}

/** The body a limited caller receives — explicit, in Vietnamese, actionable. */
export function rateLimitMessage(
  verdict: RateLimitVerdict,
  now?: number,
): string {
  const seconds = retryAfterSeconds(verdict, now);
  return `Bạn đã gửi quá nhiều yêu cầu (giới hạn ${verdict.limit} yêu cầu mỗi ${RATE_LIMIT_WINDOW_SECONDS} giây). Vui lòng thử lại sau ${seconds} giây.`;
}

export function rateLimitBody(
  verdict: RateLimitVerdict,
  now?: number,
): { error: string; code: "rate_limited" } {
  return { error: rateLimitMessage(verdict, now), code: "rate_limited" };
}
