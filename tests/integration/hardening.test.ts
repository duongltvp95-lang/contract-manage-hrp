import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A } from "./config";
import {
  adminClient,
  bucketName,
  r2Client,
  seedContractWithFile,
  signInAsAdmin,
  sweepTestRows,
  type SeededFile,
  type TestSession,
} from "./helpers";

/**
 * M8 hardening, fix 2 — the upload ceiling is enforced against the bytes that
 * actually landed in R2, not against the size the client claimed.
 *
 * The integration server runs with `MAX_UPLOAD_SIZE_MB=1` (see
 * `global-setup.ts`) so this moves 2 MB instead of 51. The code path is the
 * same; only the number differs.
 *
 * Reaching `completeUpload()` needs the test-only probe route, because it is a
 * server action that the browser only ever calls after measuring the file
 * itself — the interesting case (declare 1 KB, upload 2 MB) cannot be produced
 * through the UI at all.
 */

const suite = hasLiveBackend ? describe : describe.skip;

const DECLARED_BYTES = 1024; // comfortably under the server's 1 MB ceiling
const OVERSIZED_BYTES = 2 * 1024 * 1024;

type Presign = { fileId: string; objectKey: string; uploadUrl: string };

async function presign(
  contractId: string,
  filename: string,
  fileSize: number,
  cookie: string,
): Promise<Presign> {
  const response = await fetch(`${BASE_URL}/api/files/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      contractId,
      filename,
      mimeType: "application/pdf",
      fileSize,
    }),
  });

  if (!response.ok) {
    throw new Error(`presign failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as Presign;
}

async function completeViaProbe(
  input: Presign & { contractId: string; filename: string },
  cookie: string,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const response = await fetch(`${BASE_URL}/api/hardening-probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      contractId: input.contractId,
      fileId: input.fileId,
      objectKey: input.objectKey,
      filename: input.filename,
      mimeType: "application/pdf",
      fileSize: DECLARED_BYTES,
    }),
  });

  return {
    status: response.status,
    json: (await response.json().catch(() => null)) as Record<string, unknown> | null,
  };
}

suite("M8 hardening — the real upload size is enforced", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let contract: SeededFile;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    orgA = await signInAsAdmin();
    contract = await seedContractWithFile(admin, {
      organizationId: ORG_A,
      label: "HARDENING-SIZE",
      withObject: false,
    });
  }, 120_000);

  afterAll(async () => {
    if (contract) await contract.cleanup();
    if (admin) await sweepTestRows(admin);
  }, 120_000);

  it("still accepts a file that is genuinely within the limit (control)", async () => {
    const filename = "within-limit.pdf";
    const signed = await presign(contract.contractId, filename, DECLARED_BYTES, orgA.cookie);

    const body = Buffer.alloc(DECLARED_BYTES, 0x20);
    const put = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body,
    });
    expect(put.status).toBe(200);

    const completed = await completeViaProbe(
      { ...signed, contractId: contract.contractId, filename },
      orgA.cookie,
    );
    expect(completed.status).toBe(200);

    const { data } = await admin
      .from("contract_files")
      .select("file_size")
      .eq("id", signed.fileId)
      .maybeSingle();
    expect(data?.file_size).toBe(DECLARED_BYTES);
  }, 120_000);

  it("rejects an oversized upload with 422 AND removes the object from R2", async () => {
    const filename = "oversized.pdf";
    // Declared at 1 KB so the presign accepts it — which is precisely the hole:
    // the signature fixes the key and the content type, never a maximum length.
    const signed = await presign(contract.contractId, filename, DECLARED_BYTES, orgA.cookie);

    const body = Buffer.alloc(OVERSIZED_BYTES, 0x20);
    const put = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body,
    });
    expect(put.status, "R2 itself has no reason to refuse the PUT").toBe(200);

    // The bytes are really there — this is the state the old code accepted.
    const beforeHead = await r2Client().send(
      new HeadObjectCommand({ Bucket: bucketName(), Key: signed.objectKey }),
    );
    expect(beforeHead.ContentLength).toBe(OVERSIZED_BYTES);

    const completed = await completeViaProbe(
      { ...signed, contractId: contract.contractId, filename },
      orgA.cookie,
    );

    expect(completed.status).toBe(422);
    expect(String(completed.json?.error)).toContain("vượt quá giới hạn");
    expect(completed.json).not.toHaveProperty("id");

    // No row...
    const { data: rows } = await admin
      .from("contract_files")
      .select("id")
      .eq("id", signed.fileId);
    expect(rows ?? []).toHaveLength(0);

    // ...and, the part that used to be missing, no object either. Leaving it
    // would mean paying to store something with no row to find it by.
    await expect(
      r2Client().send(
        new HeadObjectCommand({ Bucket: bucketName(), Key: signed.objectKey }),
      ),
    ).rejects.toMatchObject({ name: "NotFound" });
  }, 180_000);

  it("rejects the oversized upload even when the client under-reports nothing", async () => {
    // Same case through a different door: presign with an honest-looking size,
    // then hand `completeUpload` a declared size that matches the lie.
    const filename = "oversized-declared-small.pdf";
    const signed = await presign(contract.contractId, filename, 512, orgA.cookie);

    await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: Buffer.alloc(OVERSIZED_BYTES, 0x20),
    });

    const completed = await completeViaProbe(
      { ...signed, contractId: contract.contractId, filename },
      orgA.cookie,
    );
    expect(completed.status).toBe(422);

    await expect(
      r2Client().send(
        new HeadObjectCommand({ Bucket: bucketName(), Key: signed.objectKey }),
      ),
    ).rejects.toMatchObject({ name: "NotFound" });
  }, 180_000);

  it("never trusts a declared size that is under the limit but wrong", async () => {
    // Belt and braces: the row records what R2 measured, not what was claimed.
    const filename = "size-recorded.pdf";
    const signed = await presign(contract.contractId, filename, 300, orgA.cookie);

    await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: Buffer.alloc(700, 0x20),
    });

    const completed = await completeViaProbe(
      { ...signed, contractId: contract.contractId, filename },
      orgA.cookie,
    );
    expect(completed.status).toBe(200);

    const { data } = await admin
      .from("contract_files")
      .select("file_size")
      .eq("id", signed.fileId)
      .maybeSingle();
    expect(data?.file_size).toBe(700);

    await admin.from("contract_files").delete().eq("id", signed.fileId);
    await r2Client().send(
      new DeleteObjectCommand({ Bucket: bucketName(), Key: signed.objectKey }),
    );
  }, 120_000);
});
