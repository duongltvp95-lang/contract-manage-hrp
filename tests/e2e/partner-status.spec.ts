import { expect, test } from "@playwright/test";

import {
  TEST_PREFIX,
  adminClient,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  runId,
  sweep,
  writeArtifact,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 10, part 2 — collaboration status + companies in the UI.
 *
 * Covers: creating a stopped partner with both companies, the list/detail
 * badges, the quick restore (with the audit sentence), the stopped partner being
 * hidden from the new-contract combobox, and importing the "Công ty" column.
 */

const stamp = runId();
const stoppedName = `${TEST_PREFIX}Đã dừng ${stamp}`;
const hiddenName = `${TEST_PREFIX}Ẩn khỏi combobox ${stamp}`;
const importedName = `${TEST_PREFIX}Nhập 2 công ty ${stamp}`;

async function buildWorkbook(
  header: string[],
  rows: (string | null)[][],
): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Đối tác");
  sheet.addRow(header);
  for (const row of rows) sheet.addRow(row.map((cell) => cell ?? ""));
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Parameters<
    typeof writeArtifact
  >[1];
  return writeArtifact(`partner-status-${stamp}.xlsx`, buffer);
}

test.describe.configure({ mode: "serial" });

test.describe("partner status + companies (round 10)", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("creates a stopped partner with both companies and shows the badges", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.getByTestId("partner-name-sheet")).toBeVisible();

    await page.fill("#partnerName", stoppedName);
    // Status → "Đã dừng hợp tác"
    await clickSafe(page, '[data-testid="partner-status-select"]');
    await page.getByRole("option", { name: "Đã dừng hợp tác" }).click();
    // Both companies
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await clickSafe(page, '[data-testid="company-checkbox-HR VN"]');

    await clickSafe(page, '[data-testid="partner-name-submit"]');
    await expect(page.getByTestId("partner-name-sheet")).toBeHidden({
      timeout: 15_000,
    });

    const row = page.getByTestId("partner-row").filter({ hasText: stoppedName });
    await expect(row).toBeVisible();

    // Grey "Đã dừng hợp tác" badge + two company badges.
    await expect(row.getByTestId("partner-status-stopped")).toBeVisible();
    await expect(row.getByTestId("partner-status-stopped")).toContainText(
      "Đã dừng hợp tác",
    );
    await expect(row.getByTestId("partner-company-badge").filter({ hasText: "HRP" })).toBeVisible();
    await expect(row.getByTestId("partner-company-badge").filter({ hasText: "HR VN" })).toBeVisible();
  });

  test("restores a stopped partner from the detail page and writes the audit sentence", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(
      page,
      `[data-testid="partner-row"][data-partner-name="${stoppedName}"] a`,
    );
    await expect(page.getByTestId("partner-detail-name")).toHaveText(stoppedName);

    // Scope to the detail header: the list page's row badge can linger in the
    // DOM during the client-side navigation.
    await expect(
      page.locator("header").getByTestId("partner-status-stopped"),
    ).toBeVisible();
    await clickSafe(page, '[data-testid="partner-restore-button"]');

    await expect(page.getByText("Đã khôi phục hợp tác với đối tác")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator("header").getByTestId("partner-status-active"),
    ).toBeVisible({ timeout: 15_000 });

    // The audit log shows the sentence.
    await gotoAndSettle(page, "/admin/logs");
    await expect(page.getByTestId("logs-table")).toContainText(
      `đã khôi phục hợp tác với đối tác “${stoppedName}”`,
    );
  });

  test("a stopped partner is hidden from the new-contract combobox", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Create a stopped partner first.
    await login(page);
    await gotoAndSettle(page, "/partners");
    await clickSafe(page, '[data-testid="partner-add-button"]');
    await page.fill("#partnerName", hiddenName);
    await clickSafe(page, '[data-testid="partner-status-select"]');
    await page.getByRole("option", { name: "Đã dừng hợp tác" }).click();
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await clickSafe(page, '[data-testid="partner-name-submit"]');
    await expect(page.getByTestId("partner-name-sheet")).toBeHidden({
      timeout: 15_000,
    });

    // The combobox does not offer it.
    await gotoAndSettle(page, "/contracts/new");
    await clickSafe(page, '[data-testid="partner-combobox"]');
    await page.getByTestId("partner-combobox-search").fill(hiddenName);

    await expect(page.getByTestId("partner-option")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("partner-combobox-list")).toContainText(
      "Không tìm thấy đối tác",
    );
  });

  test("imports the 'Công ty' column 'HRP, HR VN' into two companies", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const path = await buildWorkbook(
      ["Tên đối tác", "Địa chỉ", "Mã số thuế", "Công ty"],
      [[importedName, "Hà Nội", "0511111999", "HRP, HR VN"]],
    );

    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-import-button"]');
    await expect(page.getByTestId("partner-import-sheet")).toBeVisible();

    await page
      .locator('[data-testid="partner-import-dropzone"] input[type="file"]')
      .setInputFiles(path);

    const preview = page.getByTestId("partner-import-preview");
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("partner-import-summary")).toHaveText(
      "1 dòng sẽ thêm mới · 0 dòng sẽ cập nhật · 0 dòng lỗi",
    );

    await clickSafe(page, '[data-testid="partner-import-confirm"]');
    await expect(page.getByText("Đã nhập 1 đối tác")).toBeVisible({ timeout: 15_000 });

    // Fully successful → the sheet closes and the list refreshes.
    await expect(page.getByTestId("partner-import-sheet")).toBeHidden({
      timeout: 15_000,
    });

    const row = page.getByTestId("partner-row").filter({ hasText: importedName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId("partner-company-badge").filter({ hasText: "HRP" })).toBeVisible();
    await expect(row.getByTestId("partner-company-badge").filter({ hasText: "HR VN" })).toBeVisible();
  });
});
