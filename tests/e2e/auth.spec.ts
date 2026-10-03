import { expect, test } from "@playwright/test";

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_PREFIX,
  adminClient,
  hasLiveBackend,
  login,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Plan section 100 — Login, Logout.
 * Plan section 28 — a request without a session must never render an app route.
 */

test.describe("authentication", () => {
  test("a protected route redirects to the sign-in page when signed out", async ({ page }) => {
    await page.goto("/contracts");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a wrong password is refused and explained, not a blank page", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", `${ADMIN_PASSWORD}-wrong`);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/login/);
    // The message is rendered in the UI; no stack trace and no raw Supabase text.
    await expect(page.locator('[role="alert"], [data-sonner-toast]').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("signs in, reaches the dashboard, and signs out again", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "Đăng xuất" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // The session is really gone: a protected route bounces again.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unauthenticated browser cannot call the file API", async ({ request }) => {
    const response = await request.post("/api/files/view-url", {
      data: { fileId: "aefc9231-304e-4c26-8bf3-e1033cd70ee7" },
    });

    // JSON 401, not an HTML redirect: the browser client depends on the status.
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe("unauthenticated");
  });

  test.afterAll(async () => {
    await sweep(adminClient());
    expect(TEST_PREFIX).toBe("E2ETEST-");
  });
});
