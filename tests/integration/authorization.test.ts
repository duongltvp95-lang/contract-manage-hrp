import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  hasR2,
  seedContractWithFile,
  signInAsAdmin,
  sweepTestRows,
  type SeededFile,
  type TestSession,
} from "./helpers";

/**
 * W1-WEB-039 — authorization tests (plan sections 63, 64, 101).
 *
 * These go through the real route handlers over HTTP. A route handler needs a
 * Next request context, so the services cannot be called in-process; and the
 * whole point is to check what an attacker with a valid session but the wrong
 * tenant actually receives.
 *
 * Plan section 101 is explicit: a request for another organization's file must
 * answer 403 **and never generate an R2 URL**.
 */

const suite = hasLiveBackend ? describe : describe.skip;

type Json = Record<string, unknown>;

async function post(
  path: string,
  body: unknown,
  cookie?: string,
): Promise<{ status: number; json: Json | null; headers: Headers }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });

  return {
    status: response.status,
    json: (await response.json().catch(() => null)) as Json | null,
    headers: response.headers,
  };
}

suite("file API authorization", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;
  let ownFile: SeededFile;
  let otherFile: SeededFile;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "auth");

    ownFile = await seedContractWithFile(admin, {
      organizationId: ORG_A,
      label: "AUTH-OWN",
      withObject: true,
    });

    otherFile = await seedContractWithFile(admin, {
      organizationId: "22222222-2222-2222-2222-222222222222",
      label: "AUTH-OTHER",
      withObject: false,
    });
  }, 180_000);

  afterAll(async () => {
    if (ownFile) await ownFile.cleanup();
    if (otherFile) await otherFile.cleanup();
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 120_000);

  // --- session -------------------------------------------------------------

  it("refuses /api/files/view-url with no session (401, JSON not a redirect)", async () => {
    const result = await post("/api/files/view-url", { fileId: ownFile.fileId });
    expect(result.status).toBe(401);
    expect(result.json?.code).toBe("unauthenticated");
  });

  it("refuses /api/files/upload-url with no session (401)", async () => {
    const result = await post("/api/files/upload-url", {
      contractId: ownFile.contractId,
      filename: "a.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
    });
    expect(result.status).toBe(401);
  });

  // --- own tenant ----------------------------------------------------------

  it("issues a presigned view URL for the caller's own file", async () => {
    const result = await post("/api/files/view-url", { fileId: ownFile.fileId }, orgA.cookie);

    expect(result.status).toBe(200);
    expect(typeof result.json?.viewUrl).toBe("string");
    expect(String(result.json?.viewUrl)).toContain("X-Amz-Signature");
    expect(result.json?.objectKey).toBe(ownFile.objectKey);
  });

  it("the issued URL really downloads the object", async () => {
    if (!hasR2()) return; // needs a real bucket to fetch from

    const signed = await post("/api/files/view-url", { fileId: ownFile.fileId }, orgA.cookie);
    const download = await fetch(String(signed.json?.viewUrl));

    expect(download.status).toBe(200);
    const body = await download.text();
    expect(body.startsWith("%PDF-")).toBe(true);
  });

  it("reports the remaining rate limit budget on success", async () => {
    const result = await post("/api/files/view-url", { fileId: ownFile.fileId }, orgA.cookie);

    expect(result.status).toBe(200);
    expect(result.headers.get("x-ratelimit-limit")).toBe("60");
    expect(Number(result.headers.get("x-ratelimit-remaining"))).toBeGreaterThanOrEqual(0);
    expect(result.headers.get("x-ratelimit-reset")).toBeTruthy();
  });

  // --- plan section 101: cross-organization --------------------------------

  it("refuses another organization's file with 403", async () => {
    const result = await post("/api/files/view-url", { fileId: otherFile.fileId }, orgA.cookie);
    expect(result.status).toBe(403);
  });

  it("never generates an R2 URL for another organization's file (plan 101)", async () => {
    const result = await post("/api/files/view-url", { fileId: otherFile.fileId }, orgA.cookie);
    const serialised = JSON.stringify(result.json ?? {});

    expect(result.json).not.toHaveProperty("viewUrl");
    expect(result.json).not.toHaveProperty("objectKey");
    expect(serialised).not.toContain("X-Amz-Signature");
    expect(serialised).not.toContain("r2.cloudflarestorage.com");
    expect(serialised).not.toContain(otherFile.objectKey);
  });

  it("answers an unknown file id exactly like another organization's file", async () => {
    // Same status and same body: a 404 here would confirm which ids exist.
    const unknown = await post(
      "/api/files/view-url",
      { fileId: crypto.randomUUID() },
      orgA.cookie,
    );
    const foreign = await post(
      "/api/files/view-url",
      { fileId: otherFile.fileId },
      orgA.cookie,
    );

    expect(unknown.status).toBe(foreign.status);
    expect(unknown.json).toEqual(foreign.json);
  });

  it("refuses to presign an upload into another organization's contract", async () => {
    const result = await post(
      "/api/files/upload-url",
      {
        contractId: otherFile.contractId,
        filename: "attack.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      },
      orgA.cookie,
    );

    expect(result.status).toBe(403);
    expect(result.json).not.toHaveProperty("uploadUrl");
    expect(JSON.stringify(result.json ?? {})).not.toContain("X-Amz-Signature");
  });

  it("refuses an upload presign for a contract that does not exist", async () => {
    const result = await post(
      "/api/files/upload-url",
      {
        contractId: crypto.randomUUID(),
        filename: "a.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      },
      orgA.cookie,
    );

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.json).not.toHaveProperty("uploadUrl");
  });

  // --- input validation ----------------------------------------------------

  it("rejects a malformed JSON body with 422", async () => {
    const response = await fetch(`${BASE_URL}/api/files/view-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: orgA.cookie },
      body: "{ not json",
    });

    expect(response.status).toBe(422);
  });

  it("rejects a disallowed mime type with 422", async () => {
    const result = await post(
      "/api/files/upload-url",
      {
        contractId: ownFile.contractId,
        filename: "malware.exe",
        mimeType: "application/x-msdownload",
        fileSize: 1024,
      },
      orgA.cookie,
    );

    expect(result.status).toBe(422);
    expect(JSON.stringify(result.json)).toContain("không được hỗ trợ");
  });

  it("rejects a file over the upload ceiling with 422", async () => {
    const result = await post(
      "/api/files/upload-url",
      {
        contractId: ownFile.contractId,
        filename: "huge.pdf",
        mimeType: "application/pdf",
        fileSize: 5_000 * 1024 * 1024,
      },
      orgA.cookie,
    );

    expect(result.status).toBe(422);
    expect(JSON.stringify(result.json)).toContain("vượt quá giới hạn");
  });

  it("ignores an organizationId supplied by the client", async () => {
    // The forged organization must not appear anywhere in the signed key.
    const result = await post(
      "/api/files/upload-url",
      {
        contractId: ownFile.contractId,
        filename: `${TEST_PREFIX}forged.pdf`,
        mimeType: "application/pdf",
        fileSize: 1024,
        organizationId: "22222222-2222-2222-2222-222222222222",
      },
      orgA.cookie,
    );

    expect(result.status).toBe(200);
    expect(String(result.json?.objectKey)).toContain(`/${ORG_A}/`);
    expect(String(result.json?.objectKey)).not.toContain("22222222-2222-2222-2222-222222222222");
  });
});
