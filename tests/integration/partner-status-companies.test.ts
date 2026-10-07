import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  signInAsAdmin,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 10, part 1 — partner collaboration status + companies (HRP / HR VN).
 */

const suite = hasLiveBackend ? describe : describe.skip;

const HRP_A = "00000000-0000-4000-8000-000000000001";
const HRV_A = "00000000-0000-4000-8000-000000000002";

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

suite("partner status + companies (round 10)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;
  let startedAt: string;

  const stamp = Date.now().toString(36);

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    startedAt = new Date().toISOString();
    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "status");
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("the HRP / HR VN seed exists for the default organization", async () => {
    const { data } = await admin
      .from("companies")
      .select("name")
      .eq("organization_id", ORG_A)
      .order("name");

    expect((data ?? []).map((row) => row.name).sort()).toEqual(["HR VN", "HRP"]);
  });

  it("createPartner links two companies and list/get return them", async () => {
    const created = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Đối tác 2 công ty ${stamp}`,
      companyIds: [HRP_A, HRV_A],
    });
    expect(created.body.ok).toBe(true);
    const partnerId = (created.body.data as { id: string }).id;

    // listPartners returns an array (the probe forwards `data` directly).
    const list = await probe(orgA, "list_partners");
    const listRows =
      (list.body.data as unknown as { id: string; companies: string[]; status: string }[]) ?? [];
    const listRow = listRows.find((row) => row.id === partnerId);
    expect(listRow).toBeDefined();
    expect(listRow?.companies).toEqual(expect.arrayContaining(["HRP", "HR VN"]));
    expect(listRow?.status).toBe("active");

    // getPartner
    const detail = await probe(orgA, "get_partner", { id: partnerId });
    expect((detail.body.data as { companies: string[] }).companies).toEqual(
      expect.arrayContaining(["HRP", "HR VN"]),
    );
  }, 120_000);

  it("setPartnerStatus flips status and writes a set_partner_status audit row", async () => {
    const created = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Đối tác đổi trạng thái ${stamp}`,
      companyIds: [HRP_A],
    });
    const partnerId = (created.body.data as { id: string }).id;

    const stopped = await probe(orgA, "set_partner_status", {
      id: partnerId,
      status: "stopped",
    });
    expect(stopped.body.ok).toBe(true);
    expect((stopped.body.data as { status: string }).status).toBe("stopped");

    const { data } = await admin
      .from("audit_logs")
      .select("action, target_id, metadata")
      .eq("action", "set_partner_status")
      .eq("target_id", partnerId)
      .single();

    expect(data).toBeTruthy();
    expect(data?.metadata).toMatchObject({
      to: "stopped",
      name: `${TEST_PREFIX}Đối tác đổi trạng thái ${stamp}`,
    });
  }, 120_000);

  it("searchPartners hides stopped partners", async () => {
    const active = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Còn hợp tác ${stamp}`,
      companyIds: [HRP_A],
    });
    const stopped = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Đã dừng ${stamp}`,
      companyIds: [HRP_A],
    });
    const activeId = (active.body.data as { id: string }).id;
    const stoppedId = (stopped.body.data as { id: string }).id;

    await probe(orgA, "set_partner_status", { id: stoppedId, status: "stopped" });

    const search = await probe(orgA, "search_partners", { term: stamp });
    const ids = ((search.body.data as { id: string }[]) ?? []).map((row) => row.id);

    expect(ids).toContain(activeId);
    expect(ids).not.toContain(stoppedId);
  }, 120_000);

  it("RLS: org B cannot read org A companies or write org A junctions", async () => {
    // 1. Org B sees only its own companies, never org A's seeded ids.
    const { data: seen, error: seenError } = await orgB.client
      .from("companies")
      .select("id");
    expect(seenError).toBeNull();
    const seenIds = (seen ?? []).map((row) => row.id);
    expect(seenIds).not.toContain(HRP_A);
    expect(seenIds).not.toContain(HRV_A);

    // 2. Org B cannot link an org A partner to an org A company (both foreign
    //    resources belong to another tenant).
    const { error: writeError } = await orgB.client
      .from("partner_companies")
      .insert({ partner_id: "99999999-0000-4000-8000-000000000001", company_id: HRP_A });

    // The insert is rejected: the with-check policy requires the partner to
    // belong to the caller's organization.
    expect(writeError).toBeTruthy();
  }, 120_000);
});
