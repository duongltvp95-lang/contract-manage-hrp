import { expect, test, type Page } from "@playwright/test";

import { adminClient, gotoAndSettle, hasLiveBackend, login } from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 12–13 — the theme palette in the sidebar footer.
 *
 * The Palette button opens a popover with the accent (round 12) and background
 * (round 13) swatches. Changing a swatch updates the profile, which sets
 * `data-accent` / `data-background` on <html> server-side (`router.refresh()`).
 * The test changes the admin account's colors and resets them in `afterAll`.
 */

async function openPalette(page: Page) {
  const popover = page.getByTestId("theme-palette-popover");
  if (!(await popover.isVisible().catch(() => false))) {
    await page.getByTestId("theme-palette-button").click();
  }
  await expect(popover).toBeVisible();
}

test.describe("theme palette (round 12–13)", () => {
  test.afterAll(async () => {
    // Reset the shared admin's colors to default, no matter how the tests ended.
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const wave2 = data?.users?.find((u) => u.email === "e2e.wave2@hrpartner.vn");
    if (wave2) {
      await admin
        .from("profiles")
        .update({ accent_color: null, background_color: null })
        .eq("id", wave2.id);
    }
  });

  test("changes the accent from the sidebar palette and resets it", async ({ page }) => {
    test.setTimeout(120_000);

    await login(page);

    // Select "Xanh ngọc" (teal).
    await openPalette(page);
    await page.getByTestId("accent-swatch-teal").click();
    await expect(page.getByText("Đã đổi màu giao diện")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).toHaveAttribute("data-accent", "teal", {
      timeout: 15_000,
    });

    // The teal swatch is now active (its check is visible).
    await openPalette(page);
    await expect(
      page.getByTestId("accent-swatch-teal").getByTestId("accent-swatch-active"),
    ).toBeVisible();

    // Reload — the choice persists.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "teal", {
      timeout: 15_000,
    });

    // Click the active swatch again → back to default.
    await openPalette(page);
    await page.getByTestId("accent-swatch-teal").click();
    await expect(page.getByText("Đã đổi màu giao diện")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).not.toHaveAttribute("data-accent", {
      timeout: 15_000,
    });
  });

  test("changes the background from the sidebar palette and resets it", async ({ page }) => {
    test.setTimeout(120_000);

    await login(page);

    // Select "Kem" (cream).
    await openPalette(page);
    await page.getByTestId("background-swatch-cream").click();
    await expect(page.getByText("Đã đổi màu giao diện")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).toHaveAttribute("data-background", "cream", {
      timeout: 15_000,
    });

    await openPalette(page);
    await expect(
      page.getByTestId("background-swatch-cream").getByTestId("background-swatch-active"),
    ).toBeVisible();

    // Click the active swatch again → back to default.
    await page.getByTestId("background-swatch-cream").click();
    await expect(page.getByText("Đã đổi màu giao diện")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).not.toHaveAttribute("data-background", {
      timeout: 15_000,
    });
  });

  test("settings no longer has a color card", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/settings");

    await expect(page.getByTestId("accent-section")).toHaveCount(0);
    // The palette lives on the sidebar, reachable from settings too.
    await expect(page.getByTestId("theme-palette-button")).toBeVisible();
  });
});
