import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, TEST_PREFIX } from "./config";
import {
  adminClient,
  signInAsAdmin,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 9, part 1 — `listAuditLogs` resolves `actorName` for each row.
 *
 * The audit table stores only the actor's profile id; the name is joined in one
 * query by `listAuditLogs`. A hard-deleted actor is re-pointed to the system
 * tombstone profile (round 4), which the service treats as "no name" — the UI
 * then shows "[Người dùng đã xoá]".
 */

const suite = hasLiveBackend ? describe : describe.skip;

type AuditRow = {
  id: string;
  actorId: string;
  actorName: string | null;
  action: string;
  targetId: string | null;
};

async function probe(
  session: TestSession,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<{ status: number; body: { ok?: boolean; data?: unknown; message?: string } }> {
  const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

suite("audit — actor name resolution (round 9)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let startedAt: string;
  let adminName: string;
  let tombstoneId: string | null;

  const stamp = Date.now().toString(36);

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    startedAt = new Date().toISOString();
    orgA = await signInAsAdmin();

    const { data: actorProfile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", orgA.userId)
      .single();
    adminName = (actorProfile?.full_name as string | null) ?? "";

    const { data: tombstone } = await admin
      .from("profiles")
      .select("id")
      .eq("is_tombstone", true)
      .single();
    tombstoneId = (tombstone?.id as string | null) ?? null;
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  async function listLogs(): Promise<AuditRow[]> {
    const result = await probe(orgA, "list_logs", { action: "create_partner" });
    return (result.body.data as { rows?: AuditRow[] } | undefined)?.rows ?? [];
  }

  it("resolves the actor name to the signed-in admin", async () => {
    const created = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Đối tác tên actor ${stamp}`,
      companyIds: ["00000000-0000-4000-8000-000000000001"],
    });
    expect(created.body.ok).toBe(true);
    const partnerId = (created.body.data as { id: string }).id;

    const rows = await listLogs();
    const row = rows.find((r) => r.targetId === partnerId);

    expect(row).toBeDefined();
    expect(row?.actorName).toBe(adminName);
    expect(row?.actorName).toBeTruthy();
  }, 120_000);

  it("resolves a tombstoned (hard-deleted) actor to null", async () => {
    if (!tombstoneId) return;

    const created = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Đối tác actor xoá ${stamp}`,
      companyIds: ["00000000-0000-4000-8000-000000000001"],
    });
    const partnerId = (created.body.data as { id: string }).id;

    // Simulate the round-4 hard delete: the actor's audit rows are re-pointed
    // to the tombstone profile.
    await admin
      .from("audit_logs")
      .update({ actor_id: tombstoneId })
      .eq("target_id", partnerId)
      .eq("action", "create_partner");

    const rows = await listLogs();
    const row = rows.find((r) => r.targetId === partnerId);

    expect(row).toBeDefined();
    expect(row?.actorName).toBeNull();
  }, 120_000);

  it("the export route carries the actor name (it uses listAuditLogs)", async () => {
    await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Đối tác xuất actor ${stamp}`,
      companyIds: ["00000000-0000-4000-8000-000000000001"],
    });

    const response = await fetch(
      `${BASE_URL}/api/admin/logs/export?format=txt&action=create_partner`,
      { headers: { cookie: orgA.cookie } },
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(adminName);
  }, 120_000);
});
