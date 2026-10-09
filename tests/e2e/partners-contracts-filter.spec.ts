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
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 28 — the "Số hợp đồng" filter on the partners list.
 */

const stamp = runId();

test.describe("partners contract filter (round 28)", () => {
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

    // "Có hợp đồng" keeps only the partner with a contract.
    await clickSafe(page, '[data-testid="partner-contracts-filter"]');
    await page.getByTestId("partner-contracts-has").click();
    await expect(page).toHaveURL(/contracts=has/);
    await expect(rowWith(withContract.name)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(withoutContract.name)).toHaveCount(0);

    // "Chưa có hợp đồng" keeps only the partner without one.
    await clickSafe(page, '[data-testid="partner-contracts-filter"]');
    await page.getByTestId("partner-contracts-none").click();
    await expect(page).toHaveURL(/contracts=none/);
    await expect(rowWith(withoutContract.name)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(withContract.name)).toHaveCount(0);

    // "Tất cả" brings both back.
    await clickSafe(page, '[data-testid="partner-contracts-filter"]');
    await page.getByTestId("partner-contracts-all").click();
    await expect(rowWith(withContract.name)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(withoutContract.name)).toBeVisible();

    // The seed contract is swept by the afterAll.
  });
});
