import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { RATE_LIMIT_MAX_REQUESTS } from "@/lib/rate-limit-policy";
import { BASE_URL } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * W1-WEB-041 — the rate limit actually limits.
 *
 * The counting lives in SQL, so only a live run can prove the endpoint returns
 * 429 — a unit test of the arithmetic would not touch the function at all.
 *
 * This uses the SECOND tenant, never the admin: the counter is per user, and
 * exhausting the admin's budget here would make the other suites flaky.
 */

const suite = hasLiveBackend ? describe : describe.skip;

suite("rate limiting on /api/files/view-url", () => {
  let admin: SupabaseClient;
  let orgB: TestSession;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    orgB = await createSecondTenant(admin, "ratelimit");
  }, 120_000);

  afterAll(async () => {
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 120_000);

  it("allows requests up to the limit, then answers 429 with Retry-After", async () => {
    const attempts = RATE_LIMIT_MAX_REQUESTS + 10;

    const responses = await Promise.all(
      Array.from({ length: attempts }, () =>
        fetch(`${BASE_URL}/api/files/view-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: orgB.cookie },
          // An id that does not exist: the request is still counted, and the
          // service answers 403 without touching R2.
          body: JSON.stringify({ fileId: crypto.randomUUID() }),
        }).then(async (response) => ({
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
          limit: response.headers.get("x-ratelimit-limit"),
          remaining: response.headers.get("x-ratelimit-remaining"),
          body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
        })),
      ),
    );

    const limited = responses.filter((r) => r.status === 429);
    const allowed = responses.filter((r) => r.status !== 429);
    const distribution = responses.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    // The window can roll over mid-test, which would raise `allowed`; what must
    // hold is that the limit is enforced and is not zero.
    expect(allowed.length, `status distribution: ${JSON.stringify(distribution)}`).toBeGreaterThan(0);
    expect(limited.length, `status distribution: ${JSON.stringify(distribution)}`).toBeGreaterThan(0);

    for (const response of limited) {
      expect(response.body?.code).toBe("rate_limited");
      expect(String(response.body?.error)).toContain("quá nhiều yêu cầu");
      expect(Number(response.retryAfter)).toBeGreaterThanOrEqual(1);
      expect(response.limit).toBe(String(RATE_LIMIT_MAX_REQUESTS));
      expect(response.remaining).toBe("0");
    }
  }, 120_000);

  it("does not lock out the other endpoint", async () => {
    // Separate buckets: exhausting view-url must not stop an upload presign.
    const response = await fetch(`${BASE_URL}/api/files/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: orgB.cookie },
      body: JSON.stringify({
        contractId: crypto.randomUUID(),
        filename: "a.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      }),
    });

    expect(response.status).not.toBe(429);
  });

  it("counts each user separately", async () => {
    const admin = adminClient();
    const fresh = await createSecondTenant(admin, "ratelimit-2");

    try {
      // A brand-new user has a full budget even though the previous one is
      // exhausted — the counter is keyed on auth.uid().
      const response = await fetch(`${BASE_URL}/api/files/view-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: fresh.cookie },
        body: JSON.stringify({ fileId: crypto.randomUUID() }),
      });

      expect(response.status).not.toBe(429);
      expect(Number(response.headers.get("x-ratelimit-remaining"))).toBeLessThan(
        RATE_LIMIT_MAX_REQUESTS,
      );
    } finally {
      await destroySecondTenant(admin, fresh);
    }
  }, 120_000);
});
