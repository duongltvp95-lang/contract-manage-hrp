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
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 20, part 2 — the contracts scope tabs (active/expired/archived) and the
 * partner status tabs (all/active/stopped).
 */

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test.describe("round 20 tabs", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("contract scope tabs split expired from active", async ({ page }) => {
    const stamp = runId();
    const admin = adminClient();
    const expiredDate = localIso(new Date(Date.now() - 3 * 86_400_000));
    const activeDate = localIso(new Date(Date.now() + 3 * 86_400_000));
    const expiredNumber = `${TEST_PREFIX}HD hết hạn ${stamp}`;
    const activeNumber = `${TEST_PREFIX}HD chưa hết hạn ${stamp}`;

    await admin.from("contracts").insert([
      { organization_id: ORG_A, contract_number: expiredNumber, expiry_date: expiredDate },
      { organization_id: ORG_A, contract_number: activeNumber, expiry_date: activeDate },
    ]);

    await login(page);
    await gotoAndSettle(page, "/contracts");

    // Active (default): the expired contract is hidden, the active one shows.
    await expect(page.getByTestId("contract-tab-active")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: activeNumber })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: expiredNumber })).toHaveCount(0);

    // Expired tab: only the expired contract shows.
    await clickSafe(page, '[data-testid="contract-tab-expired"]');
    await expect(page).toHaveURL(/scope=expired/);
    await expect(page.getByRole("row").filter({ hasText: expiredNumber })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: activeNumber })).toHaveCount(0);

    // The archived tab is visible to the privileged admin (e2e.wave2).
    await expect(page.getByTestId("contract-tab-archived")).toBeVisible();
  });

  test("partner status tabs filter the directory", async ({ page }) => {
    const stamp = runId();
    const admin = adminClient();
    const activeName = `${TEST_PREFIX}ĐT đang ${stamp}`;
    const stoppedName = `${TEST_PREFIX}ĐT dừng ${stamp}`;

    await admin.from("partners").insert([
      { organization_id: ORG_A, name: activeName, status: "active" },
      { organization_id: ORG_A, name: stoppedName, status: "stopped" },
    ]);

    await login(page);
    await gotoAndSettle(page, "/partners");

    // "Tất cả" shows both.
    await expect(page.getByTestId("partner-row").filter({ hasText: activeName })).toBeVisible();
    await expect(page.getByTestId("partner-row").filter({ hasText: stoppedName })).toBeVisible();

    // "Đang hợp tác" shows only active.
    await clickSafe(page, '[data-testid="partner-tab-active"]');
    await expect(page).toHaveURL(/status=active/);
    await expect(page.getByTestId("partner-row").filter({ hasText: activeName })).toBeVisible();
    await expect(page.getByTestId("partner-row").filter({ hasText: stoppedName })).toHaveCount(0);

    // "Đã dừng hợp tác" shows only stopped.
    await clickSafe(page, '[data-testid="partner-tab-stopped"]');
    await expect(page).toHaveURL(/status=stopped/);
    await expect(page.getByTestId("partner-row").filter({ hasText: stoppedName })).toBeVisible();
    await expect(page.getByTestId("partner-row").filter({ hasText: activeName })).toHaveCount(0);
  });
});
