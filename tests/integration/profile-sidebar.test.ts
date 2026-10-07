import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 14, part 1 — `updateProfile` writes `sidebar_color` and audits it.
 */

const suite = hasLiveBackend ? describe : describe.skip;

async function probe(
  session: TestSession,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: { ok?: boolean; data?: unknown; message?: string } }> {
  const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "update_profile", payload }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

suite("profile sidebar color (round 14)", () => {
  let admin: SupabaseClient;
  let orgB: TestSession;
  let startedAt: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    orgB = await createSecondTenant(admin, "sidebar");
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("stores the sidebar color and audits the change", async () => {
    const result = await probe(orgB, {
      fullName: `${TEST_PREFIX}Đổi sidebar`,
      sidebarColor: "navy",
    });
    expect(result.body.ok).toBe(true);
    expect((result.body.data as { sidebarColor: string | null }).sidebarColor).toBe("navy");

    const { data: profile } = await admin
      .from("profiles")
      .select("sidebar_color")
      .eq("id", orgB.userId)
      .single();
    expect(profile?.sidebar_color).toBe("navy");

    const { data: audit } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("action", "update_profile")
      .eq("target_id", orgB.userId)
      .single();
    expect(audit?.metadata?.changed).toContain("sidebarColor");
  }, 120_000);

  it("clears the sidebar color when null is sent", async () => {
    const result = await probe(orgB, {
      fullName: `${TEST_PREFIX}Đổi sidebar`,
      sidebarColor: null,
    });
    expect(result.body.ok).toBe(true);

    const { data: profile } = await admin
      .from("profiles")
      .select("sidebar_color")
      .eq("id", orgB.userId)
      .single();
    expect(profile?.sidebar_color).toBeNull();
  }, 120_000);

  it("rejects an unknown sidebar color", async () => {
    const result = await probe(orgB, {
      fullName: `${TEST_PREFIX}Đổi sidebar`,
      sidebarColor: "neon",
    });
    expect(result.body.ok).toBe(false);
    expect(result.body.message).toContain("không hợp lệ");
  }, 120_000);
});
