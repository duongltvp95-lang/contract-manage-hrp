import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  bucketName,
  createSecondTenant,
  createTestUser,
  destroySecondTenant,
  hasR2,
  r2Client,
  signInAs,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 19, part 1 — hard-delete of contracts and partners is owner-email-gated.
 *
 * A throwaway privileged account (`w1test.delete-admin@hrpartner.test`, injected
 * into DELETE_ADMIN_EMAILS by global-setup) stands in for the owner; the real
 * owner account is never used.
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

async function objectExists(key: string): Promise<boolean> {
  try {
    await r2Client().send(new HeadObjectCommand({ Bucket: bucketName(), Key: key }));
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey" || name === "404") return false;
    throw error;
  }
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

suite("delete contract/partner (round 19)", () => {
  let admin: SupabaseClient;
  let normalAdmin: TestSession;
  let privileged: TestSession;
  let startedAt: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    normalAdmin = await createSecondTenant(admin, "delete-normal");
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

  it("a privileged admin deletes a contract with files (R2 + DB + audit)", async () => {
    if (!hasR2()) return;
    const stamp = Date.now().toString(36);

    const partner = await probe(privileged, "create_partner", {
      name: `${TEST_PREFIX}Đối tác xoá ${stamp}`,
      companyIds: [ORG_B_HRP],
    });
    expect(partner.ok).toBe(true);
    const partnerId = (partner.data as { id: string }).id;

    const created = await probe(privileged, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD xoá ${stamp}`,
      partnerId,
    });
    expect(created.ok).toBe(true);
    const contractId = (created.data as { id: string }).id;

    // One real object in R2.
    const fileId = crypto.randomUUID();
    const filename = `${TEST_PREFIX}xoá.pdf`;
    const objectKey = `contracts/${ORG_B}/${contractId}/${fileId}/${filename}`;
    const body = Buffer.from(`%PDF-1.4\n% ${stamp}\n%%EOF\n`, "latin1");
    await r2Client().send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: objectKey,
        Body: body,
        ContentType: "application/pdf",
      }),
    );
    const completed = await probe(privileged, "complete_upload", {
      contractId,
      fileId,
      objectKey,
      filename,
      mimeType: "application/pdf",
      fileSize: body.length,
    });
    expect(completed.ok).toBe(true);
    expect(await objectExists(objectKey)).toBe(true);

    const deleted = await probe(privileged, "delete_contract", { id: contractId });
    expect(deleted.ok).toBe(true);

    // R2 object, file row and contract row are all gone.
    expect(await objectExists(objectKey)).toBe(false);
    const { data: fileRows } = await admin
      .from("contract_files")
      .select("id")
      .eq("contract_id", contractId);
    expect(fileRows).toHaveLength(0);
    const { data: contractRows } = await admin
      .from("contracts")
      .select("id")
      .eq("id", contractId);
    expect(contractRows).toHaveLength(0);

    // The audit row carries the contract number.
    const { data: audit } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("action", "delete_contract")
      .eq("target_id", contractId)
      .single();
    expect(audit?.metadata?.contractNumber).toBe(`${TEST_PREFIX}HD xoá ${stamp}`);
  }, 180_000);

  it("a privileged admin deletes a partner without contracts", async () => {
    const stamp = Date.now().toString(36);
    const partner = await probe(privileged, "create_partner", {
      name: `${TEST_PREFIX}Đối tác xoá trơn ${stamp}`,
      companyIds: [ORG_B_HRP],
    });
    expect(partner.ok).toBe(true);
    const partnerId = (partner.data as { id: string }).id;

    const deleted = await probe(privileged, "delete_partner", { id: partnerId });
    expect(deleted.ok).toBe(true);

    const { data: rows } = await admin
      .from("partners")
      .select("id")
      .eq("id", partnerId);
    expect(rows).toHaveLength(0);

    const { data: audit } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("action", "delete_partner")
      .eq("target_id", partnerId)
      .single();
    expect(audit?.metadata?.name).toBe(`${TEST_PREFIX}Đối tác xoá trơn ${stamp}`);
  }, 120_000);

  it("refuses to delete a partner that still has contracts", async () => {
    const stamp = Date.now().toString(36);
    const partner = await probe(privileged, "create_partner", {
      name: `${TEST_PREFIX}Đối tác có hợp đồng ${stamp}`,
      companyIds: [ORG_B_HRP],
    });
    expect(partner.ok).toBe(true);
    const partnerId = (partner.data as { id: string }).id;

    const created = await probe(privileged, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD chặn xoá ${stamp}`,
      partnerId,
    });
    expect(created.ok).toBe(true);

    const deleted = await probe(privileged, "delete_partner", { id: partnerId });
    expect(deleted.ok).toBe(false);
    expect(deleted.message).toContain("hợp đồng");

    // Nothing was lost.
    const { data: partnerRows } = await admin
      .from("partners")
      .select("id")
      .eq("id", partnerId);
    expect(partnerRows).toHaveLength(1);
  }, 120_000);

  it("forbids a non-privileged admin, a regular user, and cross-org", async () => {
    const stamp = Date.now().toString(36);

    // A non-privileged admin's own contract cannot be deleted by them.
    const created = await probe(normalAdmin, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD cấm ${stamp}`,
      partnerId: null,
    });
    // create_contract requires a partner — seed it directly instead.
    expect(created.ok).toBe(false);
    const { data: seeded } = await admin
      .from("contracts")
      .insert({
        organization_id: ORG_B,
        contract_number: `${TEST_PREFIX}HD cấm ${stamp}`,
        partner_id: null,
      })
      .select("id")
      .single();
    const contractId = seeded?.id as string;

    const forbiddenAdmin = await probe(normalAdmin, "delete_contract", { id: contractId });
    expect(forbiddenAdmin.ok).toBe(false);
    expect(forbiddenAdmin.code).toBe("forbidden");

    // A regular user cannot delete a partner.
    const user = await createTestUser(admin, {
      organizationId: ORG_B,
      role: "user",
      label: "delete-user",
    });
    const userSession = await signInAs(user.email, user.password);
    const forbiddenUser = await probe(userSession, "delete_partner", { id: crypto.randomUUID() });
    expect(forbiddenUser.ok).toBe(false);
    expect(forbiddenUser.code).toBe("forbidden");

    // Cross-org: the privileged org-B admin cannot delete an org-A contract.
    const { data: orgAContract } = await admin
      .from("contracts")
      .select("id")
      .eq("organization_id", ORG_A)
      .limit(1)
      .maybeSingle();
    if (orgAContract) {
      const crossOrg = await probe(privileged, "delete_contract", { id: orgAContract.id });
      expect(crossOrg.ok).toBe(false);
    }
  }, 120_000);
});
