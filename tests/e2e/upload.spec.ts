import { expect, test } from "@playwright/test";

import {
  TEST_PREFIX,
  adminClient,
  buildJpeg,
  buildPdf,
  buildPng,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  R2_REQUEST,
  runId,
  sweep,
  writeArtifact,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Plan section 100 — Upload PDF, Upload JPG, Upload PNG, Upload multiple files,
 * Upload progress, Upload retry.
 * Plan sections 40-44 — direct-to-R2 upload with real progress, and a failure
 * that leaves the contract saved and the form intact.
 */

const stamp = runId();
const R2_PUT = R2_REQUEST;

const pdfPath = writeArtifact(`e2e-${stamp}.pdf`, buildPdf(2, `E2E ${stamp}`));
const pngPath = writeArtifact(`e2e-${stamp}.png`, buildPng(120, 80, [200, 40, 40]));
const jpgPath = writeArtifact(`e2e-${stamp}.jpg`, buildJpeg());

test.describe.configure({ mode: "serial" });

test.describe("upload", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("uploads a PDF through the form and persists the row", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}UPLOAD-PDF-${stamp}`;

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', contractNumber);
    await page.setInputFiles('input[type="file"]', pdfPath);

    await expect(page.locator("body")).toContainText(`e2e-${stamp}.pdf`);

    await clickSafe(page, '[data-testid="contract-form-submit"]');
    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 90_000 });

    const id = page.url().split("/").pop() as string;
    const admin = adminClient();

    const { data: files } = await admin
      .from("contract_files")
      .select("original_filename, mime_type, object_key, file_size")
      .eq("contract_id", id);

    expect(files).toHaveLength(1);
    expect(files?.[0]?.original_filename).toBe(`e2e-${stamp}.pdf`);
    expect(files?.[0]?.mime_type).toBe("application/pdf");
    expect(files?.[0]?.object_key).toContain(`/${id}/`);
    expect(files?.[0]?.object_key).toContain("contracts/");
    expect(files?.[0]?.file_size).toBeGreaterThan(0);
  });

  test("uploads several images in one go (PNG + JPG)", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}UPLOAD-MULTI-${stamp}`;

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', contractNumber);
    await page.setInputFiles('input[type="file"]', [pngPath, jpgPath]);

    const queue = page.locator("body");
    await expect(queue).toContainText(`e2e-${stamp}.png`);
    await expect(queue).toContainText(`e2e-${stamp}.jpg`);

    await clickSafe(page, '[data-testid="contract-form-submit"]');
    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 120_000 });

    const id = page.url().split("/").pop() as string;
    const admin = adminClient();

    const { data: files } = await admin
      .from("contract_files")
      .select("original_filename, mime_type")
      .eq("contract_id", id)
      .order("original_filename");

    expect(files).toHaveLength(2);
    expect(files?.map((file) => file.mime_type).sort()).toEqual([
      "image/jpeg",
      "image/png",
    ]);

    // Both files are listed in the viewer's selector.
    await gotoAndSettle(page, `/contracts/${id}`);
    await expect(page.locator('[data-testid="document-selector"]')).toBeVisible();
    await expect(page.locator('[data-testid^="document-option-"]')).toHaveCount(2);
  });

  test("shows real progress while the bytes are in flight", async ({ page }) => {
    // Slow the PUT down so the progress UI is observable; without this the
    // upload of a tiny fixture finishes before a single frame is painted.
    await page.route(R2_PUT, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', `${TEST_PREFIX}UPLOAD-PROGRESS-${stamp}`);
    await page.setInputFiles('input[type="file"]', pdfPath);

    await clickSafe(page, '[data-testid="contract-form-submit"]');

    const progress = page.locator('[role="progressbar"]').first();
    await expect(progress).toBeVisible({ timeout: 30_000 });

    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    await page.unroute(R2_PUT);
  });

  test("keeps the contract when the upload fails, then retries successfully", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}UPLOAD-RETRY-${stamp}`;
    let failNextPut = true;

    await page.route(R2_PUT, async (route) => {
      if (failNextPut) {
        failNextPut = false;
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', contractNumber);
    await page.setInputFiles('input[type="file"]', pdfPath);

    await clickSafe(page, '[data-testid="contract-form-submit"]');

    // Plan section 44: the contract is saved, the form keeps its values, and the
    // user is offered a retry rather than losing their input.
    const body = page.locator("body");
    await expect(body).toContainText("tải tệp lên thất bại", { timeout: 60_000 });
    await expect(body).toContainText("Thử lại");

    const admin = adminClient();
    const { data: saved } = await admin
      .from("contracts")
      .select("id")
      .eq("contract_number", contractNumber)
      .maybeSingle();
    expect(saved?.id).toBeTruthy();

    await page.getByRole("button", { name: "Thử lại" }).click();
    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 120_000 });

    const id = page.url().split("/").pop() as string;
    const { data: files } = await admin
      .from("contract_files")
      .select("id, original_filename")
      .eq("contract_id", id);

    expect(files).toHaveLength(1);
    await page.unroute(R2_PUT);
  });

  test("rejects a file type the plan does not allow", async ({ page }) => {
    const evilPath = writeArtifact(`e2e-${stamp}.exe`, Buffer.from("MZ not a document"));

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.setInputFiles('input[type="file"]', evilPath);

    // react-dropzone refuses it at the source: the user is told why, and the
    // file never reaches the upload queue.
    const body = page.locator("body");
    await expect(body).toContainText("không đúng định dạng cho phép");
    await expect(body).toContainText(`e2e-${stamp}.exe`);
    await expect(body).not.toContainText("tệp sẽ được tải lên");
  });

  test("a server-side presign still refuses a forged mime type", async ({ page }) => {
    // The client-side check is a convenience; the server is authoritative.
    await login(page);

    const response = await page.request.post("/api/files/upload-url", {
      data: {
        contractId: crypto.randomUUID(),
        filename: "evil.exe",
        mimeType: "application/x-msdownload",
        fileSize: 10,
      },
    });

    expect(response.status()).toBe(422);
    expect(await response.text()).toContain("không được hỗ trợ");
  });
});

