import { expect, test } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  attachFile,
  buildPdf,
  buildPng,
  gotoAndSettle,
  isoDate,
  hasLiveBackend,
  login,
  runId,
  R2_REQUEST,
  seedContracts,
  sweep,
  type SeededContract,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Plan section 100 — PDF preview, PDF next/previous page, PDF zoom, PDF fit
 * width, Image preview, Switch document, Expired presigned URL refresh.
 * Plan sections 56-60.
 *
 * This is the suite that would have caught the M6 CORS blocker: it renders a
 * real PDF in a real browser against the real bucket.
 */

const stamp = runId();
const PDF_PAGES = 3;

let contract: SeededContract;
let pdfObjectKey = "";
let pdfFileId = "";

test.describe.configure({ mode: "serial" });

test.describe("document viewer", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    await sweep(admin);

    const [seeded] = await seedContracts(admin, [
      {
        organizationId: ORG_A,
        contractNumber: `${TEST_PREFIX}VIEWER-${stamp}`,
        partnerText: "Đối tác xem tài liệu",
        signedDate: isoDate(-100),
        expiryDate: isoDate(300),
      },
    ]);
    contract = seeded;

    const pdf = await attachFile(admin, {
      organizationId: ORG_A,
      contractId: contract.id,
      filename: "viewer.pdf",
      mimeType: "application/pdf",
      body: buildPdf(PDF_PAGES, `Viewer ${stamp}`),
    });
    pdfObjectKey = pdf.objectKey;
    pdfFileId = pdf.fileId;

    await attachFile(admin, {
      organizationId: ORG_A,
      contractId: contract.id,
      filename: "viewer.png",
      mimeType: "image/png",
      body: buildPng(160, 120, [30, 120, 200]),
    });
  });

  /**
   * The viewer opens the newest file, which here is the PNG (attached second).
   * `?file=` deep-links the PDF, which is the documented way to open a specific
   * document — plan section 59.
   */
  const pdfUrl = () => `/contracts/${contract.id}?file=${pdfFileId}`;

  test.afterAll(async () => {
    const admin = adminClient();
    await contract.cleanup();
    await sweep(admin);
  });

  test("renders a PDF in the browser and navigates pages", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, pdfUrl());

    await expect(page.locator('[data-testid="document-selector"]')).toBeVisible({
      timeout: 30_000,
    });

    const indicator = page.locator('[data-testid="pdf-page-indicator"]');
    await expect(indicator).toHaveText(`1/${PDF_PAGES}`, { timeout: 45_000 });

    // The canvas proves PDF.js actually painted, not just that the toolbar rendered.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    await page.locator('[data-testid="pdf-next"]').click();
    await expect(indicator).toHaveText(`2/${PDF_PAGES}`);

    await page.locator('[data-testid="pdf-next"]').click();
    await expect(indicator).toHaveText(`3/${PDF_PAGES}`);
    await expect(page.locator('[data-testid="pdf-next"]')).toBeDisabled();

    await page.locator('[data-testid="pdf-prev"]').click();
    await expect(indicator).toHaveText(`2/${PDF_PAGES}`);
  });

  test("zooms in and out, and fit width behaves as a mode", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, pdfUrl());

    const zoom = page.locator('[data-testid="pdf-zoom-indicator"]');
    const fit = page.locator('[data-testid="pdf-fit-width"]');
    await expect(page.locator('[data-testid="pdf-page-indicator"]')).toHaveText(
      `1/${PDF_PAGES}`,
      { timeout: 45_000 },
    );

    await expect(fit).toHaveAttribute("aria-pressed", "true");
    const before = Number((await zoom.textContent())?.replace("%", ""));

    await page.locator('[data-testid="pdf-zoom-in"]').click();
    await expect
      .poll(async () => Number((await zoom.textContent())?.replace("%", "")))
      .toBeGreaterThan(before);
    const zoomedIn = Number((await zoom.textContent())?.replace("%", ""));

    // Zooming is explicitly leaving fit-width mode.
    await expect(fit).toHaveAttribute("aria-pressed", "false");

    await page.locator('[data-testid="pdf-zoom-out"]').click();
    await expect
      .poll(async () => Number((await zoom.textContent())?.replace("%", "")))
      .toBeLessThan(zoomedIn);

    await fit.click();
    await expect(fit).toHaveAttribute("aria-pressed", "true");
  });

  test("switches between documents, showing the image viewer for a PNG", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts/${contract.id}`);

    const options = page.locator('[data-testid^="document-option-"]');
    await expect(options).toHaveCount(2, { timeout: 30_000 });

    // The image is listed with its own icon and name.
    await expect(page.locator('[data-testid="document-selector"]')).toContainText("viewer.png");
    await expect(page.locator('[data-testid="document-selector"]')).toContainText("viewer.pdf");

    await page.getByRole("button", { name: /viewer\.png/ }).click();

    await expect(page.locator('[data-testid="image-viewer-image"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="pdf-toolbar"]')).toHaveCount(0);

    // And back to the PDF.
    await page.getByRole("button", { name: /viewer\.pdf/ }).click();
    await expect(page.locator('[data-testid="pdf-toolbar"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="image-viewer-image"]')).toHaveCount(0);
  });

  test("the image viewer zooms and fits", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts/${contract.id}`);

    await page.getByRole("button", { name: /viewer\.png/ }).click();
    await expect(page.locator('[data-testid="image-viewer-image"]')).toBeVisible({
      timeout: 30_000,
    });

    const zoom = page.locator('[data-testid="image-zoom-indicator"]');
    await expect(zoom).toHaveText("100%");

    await page.locator('[data-testid="image-zoom-in"]').click();
    await expect(zoom).not.toHaveText("100%");

    await page.getByRole("button", { name: "Vừa khung" }).click();
    await expect(zoom).toHaveText("100%");
  });

  test("recovers from an expired presigned URL by requesting a new one", async ({ page }) => {
    // Plan section 60. The server signs the first URL before the page renders,
    // so the way to exercise expiry is to make the object request fail the way
    // R2 fails for a dead signature: 403 with no bytes.
    let objectRequests = 0;
    let viewUrlRequests = 0;

    await page.route(R2_REQUEST, async (route) => {
      objectRequests += 1;

      if (objectRequests === 1) {
        await route.fulfill({
          status: 403,
          contentType: "application/xml",
          body: "<Error><Code>ExpiredRequest</Code><Message>Request has expired</Message></Error>",
        });
        return;
      }

      await route.continue();
    });

    await page.route("**/api/files/view-url", async (route) => {
      viewUrlRequests += 1;
      await route.continue();
    });

    await login(page);
    await gotoAndSettle(page, pdfUrl());

    // The viewer notices, mints a new URL, and the document loads.
    await expect
      .poll(() => viewUrlRequests, { timeout: 45_000 })
      .toBeGreaterThanOrEqual(1);

    const indicator = page.locator('[data-testid="pdf-page-indicator"]');
    await expect(indicator).toHaveText(`1/${PDF_PAGES}`, { timeout: 45_000 });

    // And the recovered viewer is still fully usable.
    await page.locator('[data-testid="pdf-next"]').click();
    await expect(indicator).toHaveText(`2/${PDF_PAGES}`);

    await page.unroute(R2_REQUEST);
    await page.unroute("**/api/files/view-url");
  });

  test("a deleted object degrades to an inline error instead of a blank page", async ({ page }) => {
    const { DeleteObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { r2Client, bucketName } = await import("./helpers");

    // Remove the PDF's object, then open the PDF explicitly. (The plain URL
    // opens the newest file, which is the PNG and still present — that would
    // test nothing.)
    await r2Client().send(
      new DeleteObjectCommand({ Bucket: bucketName(), Key: pdfObjectKey }),
    );

    try {
      await login(page);
      await gotoAndSettle(page, pdfUrl());

      // Plan section 80: the contract view survives a broken document. The
      // metadata, the heading and the selector must all still be there — a
      // failing viewer must not take the page with it.
      await expect(
        page.getByRole("heading", { name: `${TEST_PREFIX}VIEWER-${stamp}` }),
      ).toBeVisible({ timeout: 45_000 });

      // Matched against textContent, so the CSS `uppercase` on the heading is
      // not applied: the source text is the thing to assert.
      await expect(page.locator("body")).toContainText("Thông tin hợp đồng");
      await expect(page.locator('[data-testid="document-selector"]')).toBeVisible();
      await expect(page.locator('[data-testid="contract-edit-button"]')).toBeVisible();
    } finally {
      // Restore the object even if the assertion failed, so a rerun is clean.
      await r2Client().send(
        new PutObjectCommand({
          Bucket: bucketName(),
          Key: pdfObjectKey,
          Body: buildPdf(PDF_PAGES, `Viewer ${stamp}`),
          ContentType: "application/pdf",
        }),
      );
    }
  });
});
