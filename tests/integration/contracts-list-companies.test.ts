import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * Round 18, part 1 — listContracts resolves the linked partner's companies.
 */

const suite = hasLiveBackend ? describe : describe.skip;

const ORG_B_HRP = "22222222-0000-4000-8000-000000000001";
const ORG_B_HR_VN = "22222222-0000-4000-8000-000000000002";

type ListRow = {
  id: string;
  partner_id: string | null;
  companies: string[];
};

async function probe(
  session: TestSession,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok?: boolean; data?: unknown; message?: string }> {
  const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return response.json().catch(() => ({}));
}

suite("contracts list companies (round 18)", () => {
  let admin: SupabaseClient;
  let orgB: TestSession;
  let startedAt: string;
  let linkedContractId: string;
  let unlinkedContractId: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    orgB = await createSecondTenant(admin, "list-companies");
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("returns the linked partner's companies and [] for an unlinked contract", async () => {
    const stamp = Date.now().toString(36);

    const partner = await probe(orgB, "create_partner", {
      name: `${TEST_PREFIX}Đối tác công ty ${stamp}`,
      companyIds: [ORG_B_HRP, ORG_B_HR_VN],
    });
    expect(partner.ok).toBe(true);
    const partnerId = (partner.data as { id: string }).id;

    const linked = await probe(orgB, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD liên kết công ty ${stamp}`,
      partnerId,
    });
    expect(linked.ok).toBe(true);
    linkedContractId = (linked.data as { id: string }).id;

    // A legacy free-text contract (no partner link) — `createContract` refuses
    // one, so seed it directly.
    const { data: unlinkedData, error: unlinkedError } = await admin
      .from("contracts")
      .insert({
        organization_id: ORG_B,
        contract_number: `${TEST_PREFIX}HD tự do công ty ${stamp}`,
        partner_text: "Đối tác cũ",
        partner_id: null,
      })
      .select("id")
      .single();
    expect(unlinkedError).toBeNull();
    expect(unlinkedData).not.toBeNull();
    unlinkedContractId = unlinkedData!.id as string;

    const listed = await probe(orgB, "list_contracts", { pageSize: 50 });
    expect(listed.ok).toBe(true);
    const rows = (listed.data as { rows: ListRow[] }).rows;

    const linkedRow = rows.find((row) => row.id === linkedContractId);
    expect(linkedRow?.companies).toEqual(expect.arrayContaining(["HRP", "HR VN"]));
    expect(linkedRow?.companies).toHaveLength(2);

    const unlinkedRow = rows.find((row) => row.id === unlinkedContractId);
    expect(unlinkedRow?.companies).toEqual([]);
  }, 120_000);
});
