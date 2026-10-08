import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  signInAs,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 19, part 2 — unarchive + archived scope are owner-email-gated.
 */

const suite = hasLiveBackend ? describe : describe.skip;

const PRIVILEGED_EMAIL = "w1test.delete-admin@hrpartner.test";
const ORG_B_HRP = "22222222-0000-4000-8000-000000000001";

type ProbeResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  data?: unknown;
};

async function probe(
  session: TestSession,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<ProbeResult> {
  const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return response.json().catch(() => ({}));
}

async function createPrivilegedAdmin(
  admin: SupabaseClient,
  organizationId: string,
): Promise<TestSession> {
  const password = `W1Test-${Math.random().toString(36).slice(2, 12)}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email: PRIVILEGED_EMAIL,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create the privileged admin: ${error?.message}`);
  }
  await admin
    .from("profiles")
    .update({ organization_id: organizationId, role: "admin", is_active: true })
    .eq("id", data.user.id);
  return signInAs(PRIVILEGED_EMAIL, password);
}

async function makeContract(
  session: TestSession,
  label: string,
): Promise<{ contractId: string }> {
  const stamp = Date.now().toString(36);
  const partner = await probe(session, "create_partner", {
    name: `${TEST_PREFIX}Đối tác ${label} ${stamp}`,
    companyIds: [ORG_B_HRP],
  });
  expect(partner.ok).toBe(true);
  const partnerId = (partner.data as { id: string }).id;

  const created = await probe(session, "create_contract", {
    contractNumber: `${TEST_PREFIX}${label} ${stamp}`,
    partnerId,
  });
  expect(created.ok).toBe(true);
  return { contractId: (created.data as { id: string }).id };
}

suite("unarchive contract (round 19)", () => {
  let admin: SupabaseClient;
  let normalAdmin: TestSession;
  let privileged: TestSession;
  let startedAt: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    normalAdmin = await createSecondTenant(admin, "unarchive-normal");
    privileged = await createPrivilegedAdmin(admin, ORG_B);
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (privileged) await destroySecondTenant(admin, privileged);
    if (normalAdmin) await destroySecondTenant(admin, normalAdmin);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("a privileged admin unarchives an archived contract and audits it", async () => {
    const { contractId } = await makeContract(privileged, "HD-bỏ-lưu-trữ");
    await probe(privileged, "archive_contract", { id: contractId });

    const unarchived = await probe(privileged, "unarchive_contract", { id: contractId });
    expect(unarchived.ok).toBe(true);

    const { data: row } = await admin
      .from("contracts")
      .select("archived_at")
      .eq("id", contractId)
      .single();
    expect(row?.archived_at).toBeNull();

    const { data: audit } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("action", "unarchive_contract")
      .eq("target_id", contractId)
      .single();
    expect(audit?.metadata?.contractNumber).toBeTruthy();
  }, 120_000);

  it("refuses to unarchive a contract that is not archived", async () => {
    const { contractId } = await makeContract(privileged, "HD-chưa-lưu-trữ");

    const result = await probe(privileged, "unarchive_contract", { id: contractId });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa được lưu trữ");
  }, 120_000);

  it("forbids a non-privileged admin and rejects cross-org", async () => {
    // A non-privileged admin cannot unarchive (even their own contract).
    const { contractId } = await makeContract(normalAdmin, "HD-cấm-bỏ-lưu-trữ");
    await probe(normalAdmin, "archive_contract", { id: contractId });

    const forbidden = await probe(normalAdmin, "unarchive_contract", { id: contractId });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.code).toBe("forbidden");

    // Cross-org: the privileged org-B admin cannot unarchive an org-A contract.
    const { data: orgAContract } = await admin
      .from("contracts")
      .select("id")
      .eq("organization_id", ORG_A)
      .limit(1)
      .maybeSingle();
    if (orgAContract) {
      const crossOrg = await probe(privileged, "unarchive_contract", { id: orgAContract.id });
      expect(crossOrg.ok).toBe(false);
    }
  }, 120_000);

  it("listContracts scope=archived returns only archived rows", async () => {
    const active = await makeContract(privileged, "HD-active-scope");
    const archived = await makeContract(privileged, "HD-archived-scope");
    await probe(privileged, "archive_contract", { id: archived.contractId });

    const activeList = await probe(privileged, "list_contracts", { scope: "active", pageSize: 50 });
    expect(activeList.ok).toBe(true);
    const activeRows = (activeList.data as { rows: { id: string }[] }).rows;
    expect(activeRows.some((row) => row.id === active.contractId)).toBe(true);
    expect(activeRows.some((row) => row.id === archived.contractId)).toBe(false);

    const archivedList = await probe(privileged, "list_contracts", { scope: "archived", pageSize: 50 });
    expect(archivedList.ok).toBe(true);
    const archivedRows = (archivedList.data as { rows: { id: string }[] }).rows;
    expect(archivedRows.some((row) => row.id === archived.contractId)).toBe(true);
    expect(archivedRows.some((row) => row.id === active.contractId)).toBe(false);
  }, 120_000);
});
