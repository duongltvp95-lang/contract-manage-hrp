import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  bucketName,
  createSecondTenant,
  destroySecondTenant,
  hasR2,
  r2Client,
  signInAs,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 24, part 1 — bulk delete of contracts and partners.
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

async function seedPartner(
  admin: SupabaseClient,
  name: string,
  organizationId: string,
): Promise<string> {
  const { data } = await admin
    .from("partners")
    .insert({ organization_id: organizationId, name })
    .select("id")
    .single();
  await admin
    .from("partner_companies")
    .insert({ partner_id: data!.id, company_id: ORG_B_HRP });
  return data!.id as string;
}

async function seedContract(
  admin: SupabaseClient,
  contractNumber: string,
  organizationId: string,
  partnerId: string | null,
): Promise<string> {
  const { data } = await admin
    .from("contracts")
    .insert({
      organization_id: organizationId,
      contract_number: contractNumber,
      partner_id: partnerId,
    })
    .select("id")
    .single();
  return data!.id as string;
}

suite("bulk delete (round 24)", () => {
  let admin: SupabaseClient;
  let normalAdmin: TestSession;
  let privileged: TestSession;
  let startedAt: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    normalAdmin = await createSecondTenant(admin, "bulk-normal");
    privileged = await createPrivilegedAdmin(admin, ORG_B);
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin
        .from("audit_logs")
        .delete()
        .in("action", ["delete_contract", "delete_partner"])
        .gte("created_at", startedAt);
    }
    if (privileged) await destroySecondTenant(admin, privileged);
    if (normalAdmin) await destroySecondTenant(admin, normalAdmin);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("bulk-deletes contracts with files (R2 + DB + one audit row each)", async () => {
    if (!hasR2()) return;
    const stamp = Date.now().toString(36);
    const ids: string[] = [];
    const objectKeys: string[] = [];

    for (const index of [1, 2]) {
      const contractId = await seedContract(
        admin,
        `${TEST_PREFIX}HD bulk ${stamp}-${index}`,
        ORG_B,
        null,
      );
      // A real object in R2 + its file row.
      const fileId = crypto.randomUUID();
      const filename = `${TEST_PREFIX}bulk-${index}.pdf`;
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
      await admin.from("contract_files").insert({
        organization_id: ORG_B,
        contract_id: contractId,
        bucket: "contracts",
        object_key: objectKey,
        original_filename: filename,
        mime_type: "application/pdf",
        file_size: body.length,
      });
      ids.push(contractId);
      objectKeys.push(objectKey);
    }

    const deleted = await probe(privileged, "delete_contracts", { ids });
    expect(deleted.ok).toBe(true);
    const results = (deleted.data as { results: { id: string; ok: boolean }[] }).results;
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);

    const { data: rows } = await admin
      .from("contracts")
      .select("id")
      .in("id", ids);
    expect(rows).toHaveLength(0);

    // R2 objects are gone too.
    for (const key of objectKeys) {
      expect(await objectExists(key)).toBe(false);
    }

    // One audit row per deleted contract.
    const { data: audit } = await admin
      .from("audit_logs")
      .select("target_id")
      .eq("action", "delete_contract")
      .in("target_id", ids);
    expect(audit).toHaveLength(2);
  }, 180_000);

  it("bulk-deletes free partners and reports the busy one", async () => {
    const stamp = Date.now().toString(36);
    const freeA = await seedPartner(admin, `${TEST_PREFIX}ĐT bulk A ${stamp}`, ORG_B);
    const freeB = await seedPartner(admin, `${TEST_PREFIX}ĐT bulk B ${stamp}`, ORG_B);
    const busy = await seedPartner(admin, `${TEST_PREFIX}ĐT bulk bận ${stamp}`, ORG_B);
    await seedContract(admin, `${TEST_PREFIX}HD chặn bulk ${stamp}`, ORG_B, busy);

    const deleted = await probe(privileged, "delete_partners", {
      ids: [freeA, freeB, busy],
    });
    expect(deleted.ok).toBe(true);
    const results = (deleted.data as { results: { id: string; ok: boolean; error?: string }[] }).results;

    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get(freeA)?.ok).toBe(true);
    expect(byId.get(freeB)?.ok).toBe(true);
    expect(byId.get(busy)?.ok).toBe(false);
    expect(byId.get(busy)?.error).toContain("hợp đồng");

    // The busy partner survives with its contract intact.
    const { data: busyRows } = await admin
      .from("partners")
      .select("id")
      .eq("id", busy);
    expect(busyRows).toHaveLength(1);

    // Two audit rows only (the busy one was not deleted).
    const { data: audit } = await admin
      .from("audit_logs")
      .select("target_id")
      .eq("action", "delete_partner")
      .in("target_id", [freeA, freeB, busy]);
    expect(audit).toHaveLength(2);
  }, 120_000);

  it("forbids non-privileged admins and reports cross-org ids per item", async () => {
    const stamp = Date.now().toString(36);

    // A non-privileged admin cannot bulk-delete anything.
    const free = await seedPartner(admin, `${TEST_PREFIX}ĐT cấm bulk ${stamp}`, ORG_B);
    const forbidden = await probe(normalAdmin, "delete_partners", { ids: [free] });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.code).toBe("forbidden");
    const { data: stillThere } = await admin
      .from("partners")
      .select("id")
      .eq("id", free);
    expect(stillThere).toHaveLength(1);

    // Cross-org: an org-A contract id fails alone; the org-B one still goes.
    const ours = await seedContract(admin, `${TEST_PREFIX}HD cross bulk ${stamp}`, ORG_B, null);
    const { data: orgAContract } = await admin
      .from("contracts")
      .select("id")
      .eq("organization_id", ORG_A)
      .limit(1)
      .maybeSingle();

    const mixed = await probe(privileged, "delete_contracts", {
      ids: orgAContract ? [orgAContract.id, ours] : [ours],
    });
    expect(mixed.ok).toBe(true);
    const results = (mixed.data as { results: { id: string; ok: boolean }[] }).results;
    const oursResult = results.find((r) => r.id === ours);
    expect(oursResult?.ok).toBe(true);
    if (orgAContract) {
      const crossResult = results.find((r) => r.id === orgAContract.id);
      expect(crossResult?.ok).toBe(false);
    }
  }, 120_000);

  it("rejects more than 100 ids", async () => {
    const many = Array.from({ length: 101 }, () => crypto.randomUUID());
    const result = await probe(privileged, "delete_contracts", { ids: many });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("validation");
    expect(result.message).toContain("100");
  }, 120_000);
});
