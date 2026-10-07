import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, format } from "date-fns";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 15, part 1 — the dashboard lists resolve the partner name + companies.
 */

const suite = hasLiveBackend ? describe : describe.skip;

// The second tenant's seeded companies (see helpers.createSecondTenant).
const ORG_B_HRP = "22222222-0000-4000-8000-000000000001";
const ORG_B_HR_VN = "22222222-0000-4000-8000-000000000002";

type DashboardRow = {
  id: string;
  organization_id: string;
  partner_id: string | null;
  partnerName: string | null;
  companies: string[];
};

async function probe(
  session: TestSession,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok?: boolean; data?: DashboardRow[]; message?: string }> {
  const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return response.json().catch(() => ({}));
}

suite("dashboard partner + company (round 15)", () => {
  let admin: SupabaseClient;
  let orgB: TestSession;
  let startedAt: string;
  let partnerName: string;
  let linkedContractId: string;
  let unlinkedContractId: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    orgB = await createSecondTenant(admin, "dashboard");
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("returns partnerName + companies for a linked contract and empty for an unlinked one", async () => {
    const stamp = Date.now().toString(36);
    partnerName = `${TEST_PREFIX}Đối tác dashboard ${stamp}`;

    // A partner linked to BOTH companies.
    const partner = await probe(orgB, "create_partner", {
      name: partnerName,
      companyIds: [ORG_B_HRP, ORG_B_HR_VN],
    });
    expect(partner.ok).toBe(true);
    const partnerId = (partner.data as unknown as { id: string }).id;

    // A contract linked to that partner (expires within 90 days so it also lands
    // in the expiring list).
    const expiry = format(addDays(new Date(), 30), "yyyy-MM-dd");
    const linked = await probe(orgB, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD liên kết ${stamp}`,
      partnerId,
      expiryDate: expiry,
    });
    expect(linked.ok).toBe(true);
    linkedContractId = (linked.data as unknown as { id: string }).id;

    // A legacy free-text contract (no partner link). `createContract` refuses to
    // create one without a partner (owner decision), so seed it directly — this
    // is exactly the shape of contracts that predate the partners table.
    const unlinkedNumber = `${TEST_PREFIX}HD tự do ${stamp}`;
    const { data: unlinkedData, error: unlinkedError } = await admin
      .from("contracts")
      .insert({
        organization_id: ORG_B,
        contract_number: unlinkedNumber,
        partner_text: "Đối tác cũ (chỉ văn bản)",
        partner_id: null,
      })
      .select("id")
      .single();
    expect(unlinkedError).toBeNull();
    expect(unlinkedData).not.toBeNull();
    unlinkedContractId = unlinkedData!.id as string;

    const recent = await probe(orgB, "recent_contracts", { limit: 20 });
    expect(recent.ok).toBe(true);

    const linkedRow = (recent.data ?? []).find((row) => row.id === linkedContractId);
    expect(linkedRow?.partnerName).toBe(partnerName);
    expect(linkedRow?.companies).toEqual(expect.arrayContaining(["HRP", "HR VN"]));
    expect(linkedRow?.companies).toHaveLength(2);

    const unlinkedRow = (recent.data ?? []).find((row) => row.id === unlinkedContractId);
    expect(unlinkedRow?.partnerName).toBeNull();
    expect(unlinkedRow?.companies).toEqual([]);

    // Cross-org: every returned row belongs to the second tenant.
    for (const row of recent.data ?? []) {
      expect(row.organization_id).toBe(ORG_B);
    }
  }, 120_000);

  it("returns the same partner + companies in the expiring list", async () => {
    const expiring = await probe(orgB, "expiring_contracts", { limit: 20 });
    expect(expiring.ok).toBe(true);

    const linkedRow = (expiring.data ?? []).find((row) => row.id === linkedContractId);
    expect(linkedRow?.partnerName).toBe(partnerName);
    expect(linkedRow?.companies).toEqual(expect.arrayContaining(["HRP", "HR VN"]));

    // The unlinked, non-expiring contract is not in the window.
    expect((expiring.data ?? []).some((row) => row.id === unlinkedContractId)).toBe(false);
  }, 120_000);
});
