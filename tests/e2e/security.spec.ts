import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ORG_A,
  ORG_B,
  TEST_PREFIX,
  adminClient,
  attachFile,
  buildPng,
  isoDate,
  hasLiveBackend,
  login,
  runId,
  seedContracts,
  sweep,
  type SeededContract,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Plan section 100 — Cross-org DB access, Cross-org R2 access.
 * Plan section 101 — a user from org A asking for an org B file must receive
 * 403 **and never an R2 URL**.
 *
 * This is the end-to-end counterpart of the integration suite: here the request
 * comes from a real browser with a real session cookie.
 */

const stamp = runId();

let admin: SupabaseClient;
let ownContract: SeededContract;
let otherContract: SeededContract;
let ownFileId = "";
let ownObjectKey = "";
let otherFileId = "";
let otherObjectKey = "";
let secondTenantUserId = "";
const secondTenantEmail = `e2e.orgb.${stamp}@hrpartner.test`;
const secondTenantPassword = `E2E-${stamp}!aA1x`;

test.describe.configure({ mode: "serial" });

test.describe("cross-organization isolation", () => {
  test.beforeAll(async () => {
    admin = adminClient();
    await sweep(admin);

    [ownContract] = await seedContracts(admin, [
      {
        organizationId: ORG_A,
        contractNumber: `${TEST_PREFIX}ORGA-${stamp}`,
        partnerText: "Đối tác org A",
        signedDate: isoDate(-50),
        expiryDate: isoDate(300),
      },
    ]);

    // A real file belonging to org A — this is what the second tenant will try
    // to reach. (Asking for its OWN file would prove nothing.)
    const ownFile = await attachFile(admin, {
      organizationId: ORG_A,
      contractId: ownContract.id,
      filename: "org-a-secret.png",
      mimeType: "image/png",
      body: buildPng(40, 40, [200, 30, 30]),
    });
    ownFileId = ownFile.fileId;
    ownObjectKey = ownFile.objectKey;

    // The second tenant has to exist before a profile can point at it.
    await admin
      .from("organizations")
      .upsert({ id: ORG_B, name: "E2E second tenant" }, { onConflict: "id" });

    const { data: created, error } = await admin.auth.admin.createUser({
      email: secondTenantEmail,
      password: secondTenantPassword,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(`could not create the tenant user: ${error?.message}`);
    secondTenantUserId = created.user.id;

    const { error: moveError } = await admin
      .from("profiles")
      .update({ organization_id: ORG_B })
      .eq("id", secondTenantUserId);
    if (moveError) throw new Error(`could not move the tenant user: ${moveError.message}`);

    [otherContract] = await seedContracts(admin, [
      {
        organizationId: ORG_B,
        contractNumber: `${TEST_PREFIX}ORGB-${stamp}`,
        partnerText: "Đối tác org B",
        signedDate: isoDate(-50),
        expiryDate: isoDate(300),
      },
    ]);

    const attached = await attachFile(admin, {
      organizationId: ORG_B,
      contractId: otherContract.id,
      filename: "org-b-own.png",
      mimeType: "image/png",
      body: buildPng(40, 40, [10, 200, 10]),
    });
    otherFileId = attached.fileId;
    otherObjectKey = attached.objectKey;
  });

  test.afterAll(async () => {
    await ownContract.cleanup();
    await otherContract.cleanup();
    if (secondTenantUserId) {
      await admin.from("profiles").update({ organization_id: ORG_A }).eq("id", secondTenantUserId);
      await admin.auth.admin.deleteUser(secondTenantUserId);
    }
    await admin.from("organizations").delete().eq("id", ORG_B);
    await sweep(admin);
  });

  test("the organizer's own contract opens normally", async ({ page }) => {
    await login(page);
    const response = await page.goto(`/contracts/${ownContract.id}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).toContainText(`${TEST_PREFIX}ORGA-${stamp}`);
  });

  test("the second tenant cannot open the first tenant's contract", async ({ page }) => {
    await login(page, secondTenantEmail, secondTenantPassword);

    const response = await page.goto(`/contracts/${ownContract.id}`);

    // A real 404 — the authorization runs before the Suspense boundary, so the
    // status line is still open when notFound() is thrown.
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText(`${TEST_PREFIX}ORGA-${stamp}`);
  });

  test("the second tenant's list shows none of the first tenant's data", async ({ page }) => {
    await login(page, secondTenantEmail, secondTenantPassword);
    await page.goto("/contracts");

    const body = page.locator("body");
    await expect(body).not.toContainText(`${TEST_PREFIX}ORGA-${stamp}`);
    await expect(body).not.toContainText("Đối tác org A");

    // Its own contract is visible, which proves the session works at all.
    await expect(body).toContainText(`${TEST_PREFIX}ORGB-${stamp}`);
  });

  test("the second tenant's dashboard counts only its own contracts", async ({ page }) => {
    await login(page, secondTenantEmail, secondTenantPassword);
    await page.goto("/dashboard");

    const card = page.locator('[data-testid="metric-total"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText("1");
    await expect(page.locator("body")).not.toContainText(`${TEST_PREFIX}ORGA-${stamp}`);
  });

  test("view-url answers 403 for another tenant's file and returns no R2 URL", async ({ page }) => {
    await login(page, secondTenantEmail, secondTenantPassword);

    // `page.request` shares the browser context's cookies, so this is the same
    // authenticated session the viewer uses. The file belongs to ORG A.
    const response = await page.request.post("/api/files/view-url", {
      data: { fileId: ownFileId },
    });

    expect(response.status()).toBe(403);

    const text = await response.text();
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).not.toContain("r2.cloudflarestorage.com");
    expect(text).not.toContain(ownObjectKey);

    const payload = JSON.parse(text);
    expect(payload.viewUrl).toBeUndefined();
    expect(payload.objectKey).toBeUndefined();
  });

  test("the same session CAN get a URL for its own file", async ({ page }) => {
    // Guards against the 403 above passing for the wrong reason (a broken
    // session would also produce 403 — this proves the session works).
    await login(page, secondTenantEmail, secondTenantPassword);

    const response = await page.request.post("/api/files/view-url", {
      data: { fileId: otherFileId },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.objectKey).toBe(otherObjectKey);
  });

  test("view-url answers identically for a file that does not exist", async ({ page }) => {
    await login(page, secondTenantEmail, secondTenantPassword);

    const foreign = await page.request.post("/api/files/view-url", {
      data: { fileId: ownFileId },
    });
    const unknown = await page.request.post("/api/files/view-url", {
      data: { fileId: crypto.randomUUID() },
    });

    // Same status and same body: the response never confirms which ids exist.
    expect(unknown.status()).toBe(foreign.status());
    expect(await unknown.json()).toEqual(await foreign.json());
  });

  test("upload-url refuses to presign into another tenant's contract", async ({ page }) => {
    await login(page, secondTenantEmail, secondTenantPassword);

    const response = await page.request.post("/api/files/upload-url", {
      data: {
        contractId: ownContract.id,
        filename: "attack.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      },
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("X-Amz-Signature");
  });

  test("the first tenant cannot see the second tenant's contract either", async ({ page }) => {
    await login(page);

    const response = await page.goto(`/contracts/${otherContract.id}`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText(`${TEST_PREFIX}ORGB-${stamp}`);
  });
});
