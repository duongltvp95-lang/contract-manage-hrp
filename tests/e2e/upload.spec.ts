import { expect, test } from "@playwright/test";

import {
  ORG_A,
  HRP_COMPANY_ID,
  TEST_PREFIX,
  adminClient,
  buildJpeg,
  buildPdf,
  buildPng,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  saveContractAndOpenDetail,
  submitContract,
  openSavedContract,
  R2_REQUEST,
  runId,
  seedPartner,
  seedPartnerCompanyLink,
  selectCompany,
  selectPartner,
  sweep,
  writeArtifact,
  type SeededPartner,
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

/** Every create in this spec goes through the form, which now needs a partner. */
let partner: SeededPartner;

test.describe("upload", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    await sweep(admin);
    partner = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Đối tác tải tệp ${stamp}`,
    });
    // Round 33+: Select "Công ty" chỉ hiện công ty của đối tác đang chọn, nên
    // partner fixture phải có ít nhất một liên kết công ty — nếu không,
    // `selectCompany` sẽ gặp một Select bị disable.
    await seedPartnerCompanyLink(admin, partner.id, HRP_COMPANY_ID);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    // Contracts first, then the partner they point at (ON DELETE RESTRICT).
    await sweep(admin);
    await partner?.cleanup();
  });

  test("uploads a PDF through the form and persists the row", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}UPLOAD-PDF-${stamp}`;

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', contractNumber);
    await selectPartner(page, partner.name);
    // Round 33: a new contract must also name its company.
    await selectCompany(page);
    await page.setInputFiles('[data-testid="document-dropzone-input"]', pdfPath);

    await expect(page.locator("body")).toContainText(`e2e-${stamp}.pdf`);

    await saveContractAndOpenDetail(page);

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

  test("groups a document and an appendix, and hides the notes row", async ({ page }) => {
    // Two uploads in one test; give the same generous ceiling the progress test
    // uses so a slow R2 round-trip cannot fail it.
    test.setTimeout(240_000);

    const contractNumber = `${TEST_PREFIX}APPENDIX-${stamp}`;
    const docPath = writeArtifact(`e2e-doc-${stamp}.pdf`, buildPdf(1, `doc ${stamp}`));
    const appPath = writeArtifact(`e2e-app-${stamp}.pdf`, buildPdf(1, `appendix ${stamp}`));

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', contractNumber);
    await selectPartner(page, partner.name);
    // Round 33: a new contract must also name its company.
    await selectCompany(page);

    // No notes field on the create form (round 16).
    await expect(page.locator('textarea[name="notes"]')).toHaveCount(0);

    // Save the main document before attaching an appendix, as the database requires.
    await page.setInputFiles('[data-testid="document-dropzone-input"]', docPath);
    await expect(page.locator("body")).toContainText(`e2e-doc-${stamp}.pdf`);

    await saveContractAndOpenDetail(page);
    await page.getByRole("button", { name: "Thêm tài liệu", exact: true }).click();
    const uploadDialog = page.getByTestId("upload-contract-file-dialog");
    await uploadDialog.locator('input[type="file"]').setInputFiles(appPath);
    await uploadDialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Phụ lục hợp đồng", exact: true }).click();
    await uploadDialog.getByLabel("Số hợp đồng gốc", { exact: true }).fill(contractNumber);
    await uploadDialog.getByRole("button", { name: "Tải lên", exact: true }).click();
    await expect(uploadDialog).not.toBeVisible({ timeout: 60_000 });

    // Two labelled groups, each with its file.
    await expect(page.getByTestId("file-group-document")).toBeVisible();
    await expect(page.getByTestId("file-group-appendix")).toBeVisible();
    await expect(
      page.getByTestId("file-group-document").getByText(`e2e-doc-${stamp}.pdf`),
    ).toBeVisible();
    await expect(
      page.getByTestId("file-group-appendix").getByText(`e2e-app-${stamp}.pdf`),
    ).toBeVisible();

    // A new contract has no notes row.
    await expect(page.getByText("Ghi chú", { exact: true })).toHaveCount(0);

    // The edit sheet (same form) also has no notes field.
    await clickSafe(page, '[data-testid="contract-edit-button"]');
    await expect(page.locator('textarea[name="notes"]')).toHaveCount(0);
  });

  test("uploads several images in one go (PNG + JPG)", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}UPLOAD-MULTI-${stamp}`;

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', contractNumber);
    await selectPartner(page, partner.name);
    // Round 33: a new contract must also name its company.
    await selectCompany(page);
    await page.setInputFiles('[data-testid="document-dropzone-input"]', [pngPath, jpgPath]);

    const queue = page.locator("body");
    await expect(queue).toContainText(`e2e-${stamp}.png`);
    await expect(queue).toContainText(`e2e-${stamp}.jpg`);

    await saveContractAndOpenDetail(page);

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
    // The test deliberately slows the PUT so the progress UI is observable, and
    // a slow R2 round-trip can then push the whole flow past the default 90s
    // test timeout. Give THIS test its own generous ceiling — the behaviour
    // under test is unchanged, only the allowed wall-clock is raised.
    test.setTimeout(240_000);

    // Slow the PUT down so the progress UI is observable; without this the
    // upload of a tiny fixture finishes before a single frame is painted.
    await page.route(R2_PUT, async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
      }
      await route.continue();
    });

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', `${TEST_PREFIX}UPLOAD-PROGRESS-${stamp}`);
    await selectPartner(page, partner.name);
    // Round 33: a new contract must also name its company.
    await selectCompany(page);
    await page.setInputFiles('[data-testid="document-dropzone-input"]', pdfPath);

    await submitContract(page);

    const progress = page.locator('[role="progressbar"]').first();
    await expect(progress).toBeVisible({ timeout: 30_000 });

    await openSavedContract(page);
    await page.unroute(R2_PUT);
  });

  test("keeps the contract when the upload fails, then retries successfully", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}UPLOAD-RETRY-${stamp}`;
    let storageUnavailable = true;
    let failedPuts = 0;

    await page.route(R2_PUT, async (route) => {
      if (storageUnavailable && route.request().method() === "PUT") {
        failedPuts += 1;
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });

    await login(page);
    await gotoAndSettle(page, "/contracts/new");
    await page.fill('input[name="contractNumber"]', contractNumber);
    await selectPartner(page, partner.name);
    // Round 33: a new contract must also name its company.
    await selectCompany(page);
    await page.setInputFiles('[data-testid="document-dropzone-input"]', pdfPath);

    await submitContract(page);

    // Plan section 44: the contract is saved, the form keeps its values, and the
    // user is offered a retry rather than losing their input.
    const body = page.locator("body");
    await expect(body).toContainText("tải tệp lên chưa hoàn tất", { timeout: 60_000 });
    await expect(body).toContainText("Thử lại");
    await expect(page.locator('input[name="contractNumber"]')).toHaveValue(contractNumber);
    await expect(page.getByTestId("partner-combobox")).toContainText(partner.name);

    const admin = adminClient();
    const { data: saved } = await admin
      .from("contracts")
      .select("id")
      .eq("contract_number", contractNumber)
      .maybeSingle();
    expect(saved?.id).toBeTruthy();

    expect(failedPuts).toBeGreaterThanOrEqual(2);
    storageUnavailable = false;
    await page.getByRole("button", { name: "Thử lại tải tệp", exact: true }).click();
    await openSavedContract(page);

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
    await page.setInputFiles('[data-testid="document-dropzone-input"]', evilPath);

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

  test("selecting a file via the picker auto-runs AI extraction on an empty form (A11)", async ({ page }) => {
    const aiPdfName = `${TEST_PREFIX}auto-ai-${stamp}.pdf`;
    const aiPdfPath = writeArtifact(aiPdfName, buildPdf(1, `Auto AI ${stamp}`));

    await login(page);
    await gotoAndSettle(page, "/contracts/new");

    await page.setInputFiles('[data-testid="document-dropzone-input"]', aiPdfPath);

    await expect(page.locator('input[name="contractNumber"]')).toHaveValue(
      new RegExp(`^STUB-`),
      { timeout: 30_000 },
    );
    await expect(page.getByText("Tóm tắt nội dung hợp đồng từ AI")).toBeVisible();
  });
});

