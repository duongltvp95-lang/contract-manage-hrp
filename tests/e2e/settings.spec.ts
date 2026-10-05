import { expect, test, type Page } from "@playwright/test";

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
 * Feature round 2, part 3 — user management in Settings.
 *
 * Two halves, and the second is the one that matters:
 *   - an administrator sees the section, adds a user, and is shown the
 *     temporary password exactly once;
 *   - the account that was just created signs in with that password and does
 *     NOT see the section at all.
 *
 * Both screens are also checked for a delete control of any kind: removing a
 * user is not a feature of this round.
 */

const stamp = runId();
const newUserEmail = `e2e.user.${stamp}@hrpartner.test`;
const newUserName = `${TEST_PREFIX}Người dùng E2E`;

/** The administrator the suites sign in as. */
const adminEmail = process.env.TEST_ADMIN_EMAIL ?? "";

let temporaryPassword = "";

test.describe.configure({ mode: "serial" });

async function expectNoDeleteControl(page: Page): Promise<void> {
  const deleteish = /(xoá|xóa|delete|vô hiệu)/i;

  await expect(page.getByRole("button", { name: deleteish })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: deleteish })).toHaveCount(0);
  await expect(page.locator('[data-testid*="delete"]')).toHaveCount(0);
}

test.describe("settings — user management", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    // Test cleanup through the service role. The product has no delete-user
    // feature; the suite must still not leave accounts behind.
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });

    for (const user of data?.users ?? []) {
      if (user.email !== newUserEmail) continue;
      await admin.from("profiles").delete().eq("id", user.id);
      await admin.auth.admin.deleteUser(user.id);
    }

    await sweep(admin);
  });

  test("an administrator sees the section and adds a user", async ({ page }) => {
    // Creating a user is a service-role round trip plus a full page refresh.
    test.setTimeout(120_000);

    await login(page);
    await gotoAndSettle(page, "/settings");

    const section = page.getByTestId("user-management-section");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Quản lý người dùng");

    // The administrator's own row is listed, with an email read from auth.users.
    await expect(
      page.getByTestId("user-row").filter({ hasText: adminEmail }),
    ).toBeVisible();

    await expectNoDeleteControl(page);

    await clickSafe(page, '[data-testid="add-user-button"]');
    await expect(page.getByTestId("add-user-dialog")).toBeVisible();

    await page.fill("#newUserEmail", newUserEmail);
    await page.fill("#newUserFullName", newUserName);
    // The role control defaults to "Người dùng"; nothing is changed here on
    // purpose, so the default is what is being tested.
    await expect(page.getByTestId("new-user-role")).toContainText("Người dùng");

    await clickSafe(page, '[data-testid="add-user-submit"]');

    // The one-time password, with the warning that it will not be shown again.
    await expect(page.getByTestId("temporary-password-warning")).toBeVisible();
    const passwordField = page.getByTestId("temporary-password");
    await expect(passwordField).toBeVisible();

    temporaryPassword = (await passwordField.textContent())?.trim() ?? "";
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);

    await clickSafe(page, '[data-testid="close-temporary-password"]');
    await expect(page.getByTestId("add-user-dialog")).toBeHidden({ timeout: 15_000 });

    // The list refreshed and shows the new account.
    await expect(
      page.getByTestId("user-row").filter({ hasText: newUserEmail }),
    ).toBeVisible();
  });

  test("the new user can sign in and does not see the section", async ({ page }) => {
    test.setTimeout(120_000);
    expect(temporaryPassword).not.toBe("");

    await login(page, newUserEmail, temporaryPassword);
    await gotoAndSettle(page, "/settings");

    // The page renders — this is the settings page, not a redirect.
    await expect(page.getByRole("heading", { name: "Cài đặt", level: 1 })).toBeVisible();

    // …without the administrator block: not hidden with CSS, absent from the
    // server-rendered HTML.
    await expect(page.getByTestId("user-management-section")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Quản lý người dùng");
    await expect(page.getByTestId("add-user-button")).toHaveCount(0);
  });
});
