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
  {
    filename,
    kind,
    baseContractNumber,
  }: {
    filename: string;
    kind?: "document" | "appendix";
    baseContractNumber?: string;
  },
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
    ...(baseContractNumber ? { baseContractNumber } : {}),
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

    const contractNum = `${TEST_PREFIX}HD-kind-${stamp}`;
    const created = await probe(orgB, "create_contract", {
      contractNumber: contractNum,
      partnerId,
      // Round 33 — a new contract must name its company.
      companyId: "22222222-0000-4000-8000-000000000001",
    });
    expect(created.ok).toBe(true);
    contractId = (created.data as { id: string }).id;

    // 1. Kiểm tra trực tiếp tại tầng DB: Trigger DB bắt buộc chặn chèn phụ lục mồ côi
    // Bỏ qua hoàn toàn TypeScript service layer, ghi thẳng vào bảng contract_files
    const directDbOrphan = await admin.from("contract_files").insert({
      id: crypto.randomUUID(),
      organization_id: ORG_B,
      contract_id: contractId,
      original_filename: `${TEST_PREFIX}direct-orphan-appendix.pdf`,
      bucket: bucketName(),
      object_key: `contracts/${ORG_B}/${contractId}/orphan.pdf`,
      file_size: 1024,
      mime_type: "application/pdf",
      kind: "appendix",
      created_by: orgB.userId,
    });
    expect(directDbOrphan.error).not.toBeNull();
    expect(directDbOrphan.error?.code).toBe("23514"); // PostgreSQL check_violation từ require_main_contract_before_appendix()

    // 2. Kiểm tra tại tầng Service: completeUpload từ chối nếu thiếu hợp đồng chính
    const orphanFileId = crypto.randomUUID();
    const orphanKey = `contracts/${ORG_B}/${contractId}/${orphanFileId}/${TEST_PREFIX}phu-luc-fail.pdf`;
    const orphanAppendix = await probe(orgB, "complete_upload", {
      contractId,
      fileId: orphanFileId,
      objectKey: orphanKey,
      filename: `${TEST_PREFIX}phu-luc-fail.pdf`,
      mimeType: "application/pdf",
      fileSize: 1024,
      kind: "appendix",
      baseContractNumber: contractNum,
    });
    expect(orphanAppendix.ok).toBe(false);
    expect(orphanAppendix.message).toContain("Cần tải tệp hợp đồng chính lên trước khi lưu phụ lục");

    // 3. Tải tệp hợp đồng chính lên trước (kind omitted → mặc định 'document')
    const document = await uploadOne(orgB, contractId, {
      filename: `${TEST_PREFIX}tai-lieu.pdf`,
    });
    documentFileId = document.fileId;

    // 4. Sau khi đã có hợp đồng chính, tải phụ lục kèm số hợp đồng gốc thành công
    const appendix = await uploadOne(orgB, contractId, {
      filename: `${TEST_PREFIX}phu-luc.pdf`,
      kind: "appendix",
      baseContractNumber: contractNum,
    });
    appendixFileId = appendix.fileId;

    // 5. Kiểm tra trực tiếp DB trigger ngăn chặn xóa document chính khi vẫn còn phụ lục
    const directDeleteMain = await admin
      .from("contract_files")
      .delete()
      .eq("id", documentFileId);
    expect(directDeleteMain.error).not.toBeNull();
    expect(directDeleteMain.error?.code).toBe("23514"); // Trigger validate_contract_has_main_document ngăn chặn

    // 6. Kiểm tra trực tiếp DB trigger & Service: Không cho phép xóa số hợp đồng khi đã có phụ lục
    const directClearNum = await admin
      .from("contracts")
      .update({ contract_number: "" })
      .eq("id", contractId);
    expect(directClearNum.error).not.toBeNull();
    expect(directClearNum.error?.code).toBe("23514"); // Trigger contracts_prevent_clear_number_with_appendices ngăn chặn

    const serviceClearNum = await probe(orgB, "update_contract", {
      id: contractId,
      input: { contractNumber: "" },
    });
    expect(serviceClearNum.ok).toBe(false);
    expect(serviceClearNum.message).toContain("Không thể xóa số hợp đồng khi hồ sơ đã có phụ lục đính kèm");

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
