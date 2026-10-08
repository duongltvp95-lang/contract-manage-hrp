import { expect, test } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  runId,
  seedPartner,
  sweep,
  writeArtifact,
  type SeededPartner,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 7, part 2 — the import flow, in a real browser against the real backend.
 *
 * The workbook is built with exceljs inside the test, so the upload is real
 * .xlsx bytes, not a hand-made fake. Four rows exercise the whole matrix:
 * two valid, one colliding with a database tax code, one without a name.
 */

const stamp = runId();
// Tax codes are 10 digits; the base36 stamp can contain letters, so the suffix
// comes from the decimal clock instead.
const duplicateTax = `03${String(Date.now()).slice(-8)}`;

let seeded: SeededPartner;

async function buildImportWorkbook(
  header: string[],
  rows: (string | null)[][],
): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Đối tác");

  sheet.addRow(header);
  for (const row of rows) {
    sheet.addRow(row.map((cell) => cell ?? ""));
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Parameters<
    typeof writeArtifact
  >[1];
  return writeArtifact(`partners-import-${stamp}.xlsx`, buffer);
}

test.describe.configure({ mode: "serial" });

test.describe("partner import from Excel", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    await sweep(admin);

    seeded = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Đối tác đã có MST ${stamp}`,
      taxCode: duplicateTax,
    });
  });

  test.afterAll(async () => {
    const admin = adminClient();
    await sweep(admin);
    if (seeded) await seeded.cleanup();
  });

  test("previews every row, then imports the valid ones", async ({ page }) => {
    test.setTimeout(180_000);

    const nameA = `${TEST_PREFIX}Nhập A ${stamp}`;
    const nameB = `${TEST_PREFIX}Nhập B ${stamp}`;
    const dupName = `${TEST_PREFIX}Nhập trùng MST ${stamp}`;

    const path = await buildImportWorkbook(
      ["Tên đối tác", "Địa chỉ", "Mã số thuế"],
      [
        [nameA, "Hà Nội", "0511111111"],
        [nameB, "", "0511111112"],
        [dupName, "", duplicateTax],
        ["", "Chỉ có địa chỉ, thiếu tên", ""],
      ],
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

    const rows = page.getByTestId("partner-import-row");
    await expect(rows).toHaveCount(4);

    const rowWith = (text: string) =>
      page.getByTestId("partner-import-row").filter({ hasText: text });

    await expect(rowWith(nameA)).toContainText("Hợp lệ");
    await expect(rowWith(nameB)).toContainText("Hợp lệ");
    await expect(rowWith(dupName)).toContainText("Mã số thuế đã được dùng");
    await expect(rowWith("Chỉ có địa chỉ, thiếu tên")).toContainText(
      "Tên đối tác không được để trống",
    );

    await expect(page.getByTestId("partner-import-summary")).toHaveText(
      "2 dòng hợp lệ · 2 dòng lỗi",
    );

    const confirm = page.getByTestId("partner-import-confirm");
    await expect(confirm).toHaveText("Nhập 2 đối tác");
    await confirm.click();

    // Success toast…
    await expect(page.getByText("Đã nhập 2 đối tác")).toBeVisible({ timeout: 15_000 });

    // …and, because two rows failed, the sheet stays open with the per-row
    // result so the reasons remain visible.
    const result = page.getByTestId("partner-import-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText("Đã nhập 2 · Lỗi 2");
    await expect(
      result.getByTestId("partner-import-row").filter({ hasText: dupName }),
    ).toContainText("Mã số thuế đã được dùng");

    await clickSafe(page, '[data-testid="partner-import-done"]');
    await expect(page.getByTestId("partner-import-sheet")).toBeHidden({
      timeout: 15_000,
    });

    // The list refreshed: both imported partners are on screen.
    await expect(
      page.getByTestId("partner-row").filter({ hasText: nameA }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId("partner-row").filter({ hasText: nameB }),
    ).toBeVisible();

    // The database agrees: two rows created, the duplicate not.
    const admin = adminClient();
    const { data: imported } = await admin
      .from("partners")
      .select("name, tax_code")
      .like("name", `${TEST_PREFIX}Nhập%`);

    expect(imported?.map((row) => row.name).sort()).toEqual([nameA, nameB].sort());
    expect(imported?.map((row) => row.tax_code).sort()).toEqual(
      ["0511111111", "0511111112"].sort(),
    );

    const { data: duplicates } = await admin
      .from("partners")
      .select("id")
      .eq("name", dupName);
    expect(duplicates ?? []).toHaveLength(0);
  });

  test("a file without the name column shows a clear error and creates nothing", async ({ page }) => {
    test.setTimeout(120_000);

    const path = await buildImportWorkbook(
      ["Địa chỉ", "Mã số thuế"],
      [["Hà Nội", "0511111113"]],
    );

    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-import-button"]');
    await page
      .locator('[data-testid="partner-import-dropzone"] input[type="file"]')
      .setInputFiles(path);

    const error = page.getByTestId("partner-import-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText("Tên đối tác");

    // No preview, no import, no rows in the database.
    await expect(page.getByTestId("partner-import-preview")).toHaveCount(0);

    const { data } = await adminClient()
      .from("partners")
      .select("id")
      .eq("tax_code", "0511111113");
    expect(data ?? []).toHaveLength(0);
  });

  test("the status column previews the label and imports the status (round 22)", async ({ page }) => {
    test.setTimeout(180_000);

    const stoppedName = `${TEST_PREFIX}Nhập dừng ${stamp}`;
    const activeName = `${TEST_PREFIX}Nhập đang ${stamp}`;

    const path = await buildImportWorkbook(
      ["Tên đối tác", "Mã số thuế", "Trạng thái hợp tác"],
      [
        [stoppedName, "0511111141", "Đã dừng hợp tác"],
        // Empty status cell → defaults to active at the service.
        [activeName, "0511111142", ""],
      ],
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

    // The preview shows the per-row status label.
    const rowWith = (text: string) =>
      page.getByTestId("partner-import-row").filter({ hasText: text });

    await expect(rowWith(stoppedName).getByTestId("partner-import-row-status")).toHaveText(
      "Đã dừng hợp tác",
    );
    await expect(rowWith(activeName).getByTestId("partner-import-row-status")).toHaveText(
      "Đang hợp tác",
    );

    await page.getByTestId("partner-import-confirm").click();
    await expect(page.getByText("Đã nhập 2 đối tác")).toBeVisible({ timeout: 15_000 });

    // The database agrees on both statuses.
    const admin = adminClient();
    const { data } = await admin
      .from("partners")
      .select("name, status")
      .in("name", [stoppedName, activeName])
      .order("name");
    const stopped = data?.find((row) => row.name === stoppedName);
    const active = data?.find((row) => row.name === activeName);
    expect(stopped?.status).toBe("stopped");
    expect(active?.status).toBe("active");

    // The refreshed list shows the badges.
    await gotoAndSettle(page, "/partners");
    const stoppedRow = page.getByTestId("partner-row").filter({ hasText: stoppedName });
    await expect(stoppedRow).toBeVisible({ timeout: 30_000 });
    await expect(stoppedRow).toContainText("Đã dừng hợp tác");

    const activeRow = page.getByTestId("partner-row").filter({ hasText: activeName });
    await expect(activeRow).toContainText("Đang hợp tác");
  });
});
