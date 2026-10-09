import { expect, test } from "@playwright/test";

import {
  adminClient,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 23 — the "Xuất Excel" menu downloads the right scope directly.
 */

test.describe("partner export (round 23)", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("the export menu offers three items and downloads the active scope", async ({ page }) => {
    test.setTimeout(120_000);

    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partners-export-button"]');
    await expect(page.getByTestId("partners-export-item-all")).toBeVisible();
    await expect(page.getByTestId("partners-export-item-active")).toBeVisible();
    await expect(page.getByTestId("partners-export-item-stopped")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await clickSafe(page, '[data-testid="partners-export-item-active"]');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^doi-tac-dang-hop-tac-\d{8}\.xlsx$/,
    );
  });
});
