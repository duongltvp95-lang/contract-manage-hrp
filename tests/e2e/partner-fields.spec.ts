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
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 21, part 2 — partner region + abbreviation in the form, list, detail,
 * and the contract-form combobox.
 */

test.describe.configure({ mode: "serial" });

const stamp = runId();
const partnerName = `${TEST_PREFIX}ĐT vùng ${stamp}`;
let partnerId = "";

test.describe("partner region + abbreviation", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("creates with region + abbreviation and shows them in list and detail", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerName", partnerName);
    await page.fill("#partnerRegion", "Miền Bắc");
    await page.fill("#partnerAbbreviation", "ĐK");
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await clickSafe(page, '[data-testid="partner-name-submit"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    const row = page.getByTestId("partner-row").filter({ hasText: partnerName });
    await expect(row).toBeVisible();
    // Round 26 — the abbreviation lives in its own column, and the Khu vực
    // column shows the region.
    await expect(row.locator('[data-testid^="partner-abbr-cell-"]')).toHaveText("ĐK");
    await expect(row).toContainText("Miền Bắc");

    // Capture the id for later tests, then open the detail.
    const { data } = await adminClient()
      .from("partners")
      .select("id")
      .eq("name", partnerName)
      .single();
    partnerId = data?.id as string;
    expect(partnerId).toBeTruthy();

    await gotoAndSettle(page, `/partners/${partnerId}`);
    await expect(page.getByTestId("partner-detail-region")).toHaveText("Miền Bắc");
    await expect(page.getByTestId("partner-detail-abbreviation")).toHaveText("ĐK");
  });

  test("the contract-form combobox finds the partner by abbreviation", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/contracts/new");

    await clickSafe(page, '[data-testid="partner-combobox"]');
    await page.fill('[data-testid="partner-combobox-search"]', "ĐK");

    await expect(
      page.getByTestId("partner-option").filter({ hasText: partnerName }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("edits the abbreviation and the column follows", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/partners/${partnerId}`);

    await clickSafe(page, '[data-testid="partner-rename-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerAbbreviation", "ABC");
    await clickSafe(page, '[data-testid="partner-name-submit"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    await expect(page.getByTestId("partner-detail-abbreviation")).toHaveText("ABC");

    // The list column follows too.
    await gotoAndSettle(page, "/partners");
    const row = page.getByTestId("partner-row").filter({ hasText: partnerName });
    await expect(row.locator('[data-testid^="partner-abbr-cell-"]')).toHaveText("ABC");
  });
});
