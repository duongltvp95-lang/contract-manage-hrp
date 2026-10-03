import { describe, expect, it } from "vitest";

import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
  rateLimitBody,
  rateLimitHeaders,
  rateLimitMessage,
  retryAfterSeconds,
  type RateLimitVerdict,
} from "@/lib/rate-limit-policy";

/**
 * W1-WEB-041 — rate limit policy.
 *
 * The counting itself lives in SQL (see the migration) and is covered by the
 * integration suite; this file covers the arithmetic and the response wording,
 * which is what a caller actually sees.
 */

const verdict = (over: Partial<RateLimitVerdict> = {}): RateLimitVerdict => ({
  allowed: true,
  limit: RATE_LIMIT_MAX_REQUESTS,
  remaining: 42,
  resetAt: "2026-10-03T08:01:00.000Z",
  ...over,
});

const NOW = Date.parse("2026-10-03T08:00:00.000Z");

describe("the configured policy", () => {
  it("is 60 requests per 60 seconds", () => {
    expect(RATE_LIMIT_MAX_REQUESTS).toBe(60);
    expect(RATE_LIMIT_WINDOW_SECONDS).toBe(60);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up to whole seconds", () => {
    expect(retryAfterSeconds(verdict(), NOW)).toBe(60);
    expect(
      retryAfterSeconds(verdict({ resetAt: "2026-10-03T08:00:00.400Z" }), NOW),
    ).toBe(1);
  });

  it("never returns less than 1, as RFC 9110 requires", () => {
    // The window has already reset: the raw difference is negative, and a
    // Retry-After of 0 or -60 would be meaningless to a client.
    expect(retryAfterSeconds(verdict(), NOW + 120_000)).toBe(1);
    expect(retryAfterSeconds(verdict({ resetAt: "not-a-date" }), NOW)).toBe(
      RATE_LIMIT_WINDOW_SECONDS,
    );
  });

  it("falls back to the window length when the timestamp is unusable", () => {
    expect(retryAfterSeconds(verdict({ resetAt: "nonsense" }), NOW)).toBe(
      RATE_LIMIT_WINDOW_SECONDS,
    );
  });
});

describe("rateLimitHeaders", () => {
  it("emits the standard X-RateLimit-* trio", () => {
    expect(rateLimitHeaders(verdict())).toEqual({
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "42",
      "X-RateLimit-Reset": "2026-10-03T08:01:00.000Z",
    });
  });
});

describe("rateLimitMessage", () => {
  it("states the limit, the window and how long to wait", () => {
    const message = rateLimitMessage(verdict(), NOW);
    expect(message).toContain("quá nhiều yêu cầu");
    expect(message).toContain("60 yêu cầu mỗi 60 giây");
    expect(message).toContain("60 giây");
  });
});

describe("rateLimitBody", () => {
  it("is the JSON a 429 returns", () => {
    expect(rateLimitBody(verdict(), NOW)).toEqual({
      error: rateLimitMessage(verdict(), NOW),
      code: "rate_limited",
    });
  });
});
