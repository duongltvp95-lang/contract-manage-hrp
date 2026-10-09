import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  bucketName,
  createSecondTenant,
  destroySecondTenant,
  hasR2,
  r2Client,
  seedPartner,
  signInAsAdmin,
  sweepTestRows,
  type SeededPartner,
  type TestSession,
} from "./helpers";

/**
 * Round 8, part 1 — business actions write exactly one audit row each.
 *
 * The audit is attributed through `recordCurrentUserAudit`, which reads the
 * CURRENT session user, so the actions run through the test probe route (the
 * same mechanism the server actions use — the session comes from the request
 * cookie, never from the body).
 */

const suite = hasLiveBackend ? describe : describe.skip;

type AuditDbRow = {
  id: string;
  organization_id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_kind: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
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

async function auditRows(
  admin: SupabaseClient,
  action: string,
  since?: string,
): Promise<AuditDbRow[]> {
  let query = admin
    .from("audit_logs")
    .select("id, organization_id, actor_id, actor_role, action, target_kind, target_id, metadata")
    .eq("action", action);
  if (since) query = query.gte("created_at", since);
  const { data } = await query;
  return (data ?? []) as AuditDbRow[];
}

suite("audit — business actions (round 8)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;
  let seededPartner: SeededPartner;
  let startedAt: string;

  const stamp = Date.now().toString(36);
  const numericStamp = String(Date.now()).slice(-8);
  const taxInDb = `05${numericStamp}`;
  // Seeded company ids: HRP for org A, HRP for org B (round 10).
  const HRP_A = "00000000-0000-4000-8000-000000000001";
  const HRP_B = "22222222-0000-4000-8000-000000000001";

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    startedAt = new Date().toISOString();

    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "audit");

    seededPartner = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Đối tác đã có ${stamp}`,
      taxCode: taxInDb,
    });
  }, 180_000);

  afterAll(async () => {
    // Audit rows first: they reference the org-B actor's profile, which
    // destroySecondTenant then deletes (actor_id is ON DELETE RESTRICT).
    if (startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (seededPartner) await seededPartner.cleanup();
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("create_partner writes one row with the actor, target and metadata", async () => {
    const result = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Đối tác log ${stamp}`,
      address: "Hà Nội",
      taxCode: "0511111111",
      companyIds: [HRP_A],
    });

    expect(result.body.ok).toBe(true);
    const partnerId = (result.body.data as { id: string }).id;

    const rows = await auditRows(admin, "create_partner");
    const row = rows.find((r) => r.target_id === partnerId);

    expect(row).toBeDefined();
    expect(row).toMatchObject({
      organization_id: ORG_A,
      actor_id: orgA.userId,
      actor_role: "admin",
      target_kind: "partner",
      target_id: partnerId,
    });
    expect(row?.metadata).toMatchObject({
      name: `${TEST_PREFIX}Đối tác log ${stamp}`,
      taxCode: "0511111111",
    });
  }, 120_000);

  it("a regular user (role=user) still logs, scoped to their own organization", async () => {
    const result = await probe(orgB, "create_partner", {
      name: `${TEST_PREFIX}Đối tác org B ${stamp}`,
      companyIds: [HRP_B],
    });

    expect(result.body.ok).toBe(true);
    const partnerId = (result.body.data as { id: string }).id;

    const rows = await auditRows(admin, "create_partner");
    const row = rows.find((r) => r.target_id === partnerId);

    expect(row).toBeDefined();
    expect(row).toMatchObject({
      organization_id: ORG_B,
      actor_id: orgB.userId,
      actor_role: "user",
      target_kind: "partner",
    });
  }, 120_000);

  it("create/update/archive contract each write one row", async () => {
    const created = await probe(orgA, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD-${stamp}`,
      partnerId: seededPartner.id,
      notes: "ghi chú",
    });
    expect(created.body.ok).toBe(true);
    const contractId = (created.body.data as { id: string }).id;

    const updated = await probe(orgA, "update_contract", {
      id: contractId,
      input: { notes: "đã sửa" },
    });
    expect(updated.body.ok).toBe(true);

    const archived = await probe(orgA, "archive_contract", { id: contractId });
    expect(archived.body.ok).toBe(true);

    const createdRows = (await auditRows(admin, "create_contract")).filter(
      (r) => r.target_id === contractId,
    );
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      actor_id: orgA.userId,
      target_kind: "contract",
    });
    expect(createdRows[0].metadata).toMatchObject({
      contractNumber: `${TEST_PREFIX}HD-${stamp}`,
      partnerName: seededPartner.name,
    });

    const updateRows = (await auditRows(admin, "update_contract")).filter(
      (r) => r.target_id === contractId,
    );
    expect(updateRows).toHaveLength(1);
    expect(updateRows[0].metadata).toMatchObject({ changed: ["notes"] });

    const archiveRows = (await auditRows(admin, "archive_contract")).filter(
      (r) => r.target_id === contractId,
    );
    expect(archiveRows).toHaveLength(1);
    expect(archiveRows[0].metadata).toMatchObject({
      contractNumber: `${TEST_PREFIX}HD-${stamp}`,
    });
  }, 120_000);

  it("update_partner logs the changed fields", async () => {
    const created = await probe(orgA, "create_partner", {
      name: `${TEST_PREFIX}Sửa đối tác ${stamp}`,
      companyIds: [HRP_A],
    });
    const partnerId = (created.body.data as { id: string }).id;

    const updated = await probe(orgA, "update_partner", {
      id: partnerId,
      input: { name: `${TEST_PREFIX}Sửa đối tác ${stamp} (mới)`, taxCode: "0511111112" },
    });
    expect(updated.body.ok).toBe(true);

    const rows = (await auditRows(admin, "update_partner")).filter(
      (r) => r.target_id === partnerId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ changed: ["name", "taxCode"] });
  }, 120_000);

  it("import_partners writes exactly one row with created/updated/failed counts (round 25)", async () => {
    const result = await probe(orgA, "import_partners", {
      rows: [
        { rowNumber: 2, name: `${TEST_PREFIX}Nhập 1 ${stamp}`, address: "", taxCode: "0511111121", companies: ["HRP"] },
        { rowNumber: 3, name: `${TEST_PREFIX}Nhập 2 ${stamp}`, address: "", taxCode: "0511111122", companies: ["HRP"] },
        // Matches `taxInDb` seeded above → MERGES (round 25) instead of failing.
        { rowNumber: 4, name: `${TEST_PREFIX}Nhập trùng ${stamp}`, address: "", taxCode: taxInDb, companies: ["HRP"] },
      ],
    });

    expect(result.body).toMatchObject({ ok: true });

    // `import_partners` has a NULL target, so it cannot be found by target id.
    // Scope to this file's window instead of counting globally: other files in
    // the suite also import partners and their rows are equally valid.
    const rows = await auditRows(admin, "import_partners", startedAt);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: ORG_A,
      actor_id: orgA.userId,
      target_kind: "partner",
      target_id: null,
    });
    expect(rows[0].metadata).toMatchObject({ created: 2, updated: 1, failed: 0 });
  }, 120_000);

  it("update_profile writes one row", async () => {
    // Uses the throwaway org-B user so the shared admin account's name is never
    // touched by the test.
    const result = await probe(orgB, "update_profile", {
      fullName: "Tên mới từ test audit",
    });
    expect(result.body.ok).toBe(true);

    const rows = (await auditRows(admin, "update_profile")).filter(
      (r) => r.target_id === orgB.userId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ changed: ["fullName"] });
  }, 120_000);

  it("upload_file writes one row after a real upload", async () => {
    if (!hasR2()) return;

    const created = await probe(orgA, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD-TẢI-${stamp}`,
      partnerId: seededPartner.id,
    });
    const contractId = (created.body.data as { id: string }).id;

    const fileId = crypto.randomUUID();
    const filename = `${TEST_PREFIX}audit-file.pdf`;
    const objectKey = `contracts/${ORG_A}/${contractId}/${fileId}/${filename}`;
    const body = Buffer.from(`%PDF-1.4\n% ${stamp}\n%%EOF\n`, "latin1");

    await r2Client().send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: objectKey,
        Body: body,
        ContentType: "application/pdf",
      }),
    );

    const completed = await probe(orgA, "complete_upload", {
      contractId,
      fileId,
      objectKey,
      filename,
      mimeType: "application/pdf",
      fileSize: body.length,
    });
    expect(completed.body.ok).toBe(true);

    const rows = (await auditRows(admin, "upload_file")).filter(
      (r) => r.target_id === fileId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: ORG_A,
      actor_id: orgA.userId,
      target_kind: "file",
    });
    expect(rows[0].metadata).toMatchObject({ filename, size: body.length });
  }, 180_000);

  it("a failed business action writes no audit row", async () => {
    const before = (await auditRows(admin, "create_partner")).length;

    const failed = await probe(orgA, "create_partner", { name: "", companyIds: [HRP_A] });
    expect(failed.body.ok).toBe(false);

    const after = (await auditRows(admin, "create_partner")).length;
    expect(after).toBe(before);
  }, 120_000);

  it("org B's user cannot read org A's audit rows (RLS)", async () => {
    // role='user' sees nothing at all; the policy additionally scopes SELECT to
    // the caller's own organization, so this is empty rather than an error.
    const { data, error } = await orgB.client.from("audit_logs").select("id");

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  }, 120_000);
});
