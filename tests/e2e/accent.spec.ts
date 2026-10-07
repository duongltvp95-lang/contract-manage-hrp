import { expect, test } from "@playwright/test";

import { adminClient, gotoAndSettle, hasLiveBackend, login } from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 12, part 2 — the accent color picker.
 *
 * The swatch updates the profile, which sets `data-accent` on <html> server-side
 * (the picker calls `router.refresh()` after saving). The test changes the admin
 * account's accent and resets it in `afterAll` so the shared account is left at
 * the default.
 */

test.describe("accent color picker (round 12)", () => {
  test.afterAll(async () => {
    // Reset the shared admin's accent back to the default, no matter how the
    // test ended.
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const wave2 = data?.users?.find((u) => u.email === "e2e.wave2@hrpartner.vn");
    if (wave2) {
      await admin.from("profiles").update({ accent_color: null }).eq("id", wave2.id);
    }
  });

  test("selects teal, persists across reload, and resets to default", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await login(page);
    await gotoAndSettle(page, "/settings");

    await expect(page.getByTestId("accent-section")).toBeVisible();

    // Select "Xanh ngọc" (teal).
    await page.getByTestId("accent-swatch-teal").click();
    await expect(page.getByText("Đã đổi màu giao diện")).toBeVisible({
      timeout: 15_000,
    });

    // The server re-rendered <html data-accent="teal">, and the teal swatch is
    // the active one (its check icon is visible).
    await expect(page.locator("html")).toHaveAttribute("data-accent", "teal", {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("accent-swatch-teal").getByTestId("accent-swatch-active"),
    ).toBeVisible();

    // Reload — the choice persists.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "teal", {
      timeout: 15_000,
    });
    await gotoAndSettle(page, "/settings");
    await expect(
      page.getByTestId("accent-swatch-teal").getByTestId("accent-swatch-active"),
    ).toBeVisible();

    // Click the active swatch again → back to the default (data-accent gone).
    await page.getByTestId("accent-swatch-teal").click();
    await expect(page.getByText("Đã đổi màu giao diện")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).not.toHaveAttribute("data-accent", {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("accent-swatch-blue").getByTestId("accent-swatch-active"),
    ).toBeVisible();
  });
});
