import { expect, test } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  gotoAndSettle,
  hasLiveBackend,
  login,
  runId,
  seedPartner,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 28 / Round 37 — the "Số hợp đồng" filter on the partners list.
 *
 * Round 28 originally put this filter as a `Select` next to the status tabs and
 * wrote straight into the URL. Round 37 folded it into the Excel-style
 * column filter popover inside the table — single-select with three options
 * (Tất cả / 0 hợp đồng / Có hợp đồng). The same coverage, but the
 * interaction now lives inside the header.
 */

const stamp = runId();

test.describe("partners contract filter (round 37)", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("filters the list by contract count", async ({ page }) => {
    test.setTimeout(180_000);

    const admin = adminClient();
    const withContract = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Có HĐ ${stamp}`,
    });
    const withoutContract = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Không HĐ ${stamp}`,
    });
    await admin.from("contracts").insert({
      organization_id: ORG_A,
      contract_number: `${TEST_PREFIX}HĐ filter ${stamp}`,
      partner_id: withContract.id,
    });

    await login(page);
    await gotoAndSettle(page, "/partners");

    const rowWith = (name: string) =>
      page.getByTestId("partner-row").filter({ hasText: name });

    // Both are visible with no filter.
    await expect(rowWith(withContract.name)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(withoutContract.name)).toBeVisible();

    // Open the "Số hợp đồng" popover and pick "Có hợp đồng".
    await page
      .getByTestId("partner-filter-contract-count-trigger")
      .click();
    await page
      .getByTestId("partner-filter-contract-count-option-nonzero")
      .click();
    // Click outside to close the popover.
    await page.keyboard.press("Escape");
    await expect(rowWith(withContract.name)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(withoutContract.name)).toHaveCount(0);

    // Switch to "0 hợp đồng" — the empty state appears, then the other
    // partner is back when we pick the third option.
    await page
      .getByTestId("partner-filter-contract-count-trigger")
      .click();
    await page
      .getByTestId("partner-filter-contract-count-option-zero")
      .click();
    await page.keyboard.press("Escape");
    await expect(rowWith(withoutContract.name)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(withContract.name)).toHaveCount(0);

    // The "Xoá tất cả filter" button at the top brings both back.
    await page.getByTestId("partners-clear-filters").click();
    await expect(rowWith(withContract.name)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(withoutContract.name)).toBeVisible();

    // The seed contract is swept by the afterAll.
  });
});
