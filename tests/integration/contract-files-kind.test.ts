import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  bucketName,
  createSecondTenant,
  destroySecondTenant,
  hasR2,
  r2Client,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 16, part 1 — contract_files.kind is stored for appendix vs document and
 * surfaced by listContractFiles.
 */

const suite = hasLiveBackend ? describe : describe.skip;

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

async function uploadOne(
  orgB: TestSession,
  contractId: string,
  { filename, kind }: { filename: string; kind?: "document" | "appendix" },
): Promise<{ fileId: string; objectKey: string; size: number }> {
  const fileId = crypto.randomUUID();
  const objectKey = `contracts/${ORG_B}/${contractId}/${fileId}/${filename}`;
  const body = Buffer.from(`%PDF-1.4\n% ${filename}\n%%EOF\n`, "latin1");

  await r2Client().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: objectKey,
      Body: body,
      ContentType: "application/pdf",
    }),
  );

  const completed = await probe(orgB, "complete_upload", {
    contractId,
    fileId,
    objectKey,
    filename,
    mimeType: "application/pdf",
    fileSize: body.length,
    ...(kind ? { kind } : {}),
  });
  expect(completed.ok).toBe(true);

  return { fileId, objectKey, size: body.length };
}

suite("contract_files.kind (round 16)", () => {
  let admin: SupabaseClient;
  let orgB: TestSession;
  let startedAt: string;
  let contractId: string;
  let appendixFileId: string;
  let documentFileId: string;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    startedAt = new Date().toISOString();
    orgB = await createSecondTenant(admin, "kind");
  }, 180_000);

  afterAll(async () => {
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("stores 'appendix' and 'document' and returns them via listContractFiles", async () => {
    if (!hasR2()) return;

    const stamp = Date.now().toString(36);

    // A partner + contract (create_contract requires a linked partner).
    const partner = await probe(orgB, "create_partner", {
      name: `${TEST_PREFIX}Đối tác kind ${stamp}`,
      companyIds: ["22222222-0000-4000-8000-000000000001"],
    });
    expect(partner.ok).toBe(true);
    const partnerId = (partner.data as { id: string }).id;

    const created = await probe(orgB, "create_contract", {
      contractNumber: `${TEST_PREFIX}HD-kind-${stamp}`,
      partnerId,
    });
    expect(created.ok).toBe(true);
    contractId = (created.data as { id: string }).id;

    // An appendix (explicit kind) and a document (kind omitted → default).
    const appendix = await uploadOne(orgB, contractId, {
      filename: `${TEST_PREFIX}phu-luc.pdf`,
      kind: "appendix",
    });
    appendixFileId = appendix.fileId;

    const document = await uploadOne(orgB, contractId, {
      filename: `${TEST_PREFIX}tai-lieu.pdf`,
    });
    documentFileId = document.fileId;

    // The DB stores each kind on the right row.
    const { data: rows } = await admin
      .from("contract_files")
      .select("id, kind")
      .eq("contract_id", contractId);

    const appendixRow = rows?.find((row) => row.id === appendixFileId);
    const documentRow = rows?.find((row) => row.id === documentFileId);
    expect(appendixRow?.kind).toBe("appendix");
    expect(documentRow?.kind).toBe("document");

    // listContractFiles surfaces kind for both.
    const listed = await probe(orgB, "list_contract_files", { contractId });
    expect(listed.ok).toBe(true);
    const listedRows = listed.data as { id: string; kind: string }[];
    expect(listedRows.find((row) => row.id === appendixFileId)?.kind).toBe("appendix");
    expect(listedRows.find((row) => row.id === documentFileId)?.kind).toBe("document");
  }, 180_000);
});
