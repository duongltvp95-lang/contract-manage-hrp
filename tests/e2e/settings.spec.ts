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
 * The app intentionally has no delete-user action. The settings page is also
 * checked for the absence of any "delete" control: removing a user is not a
 * feature of this round, and the assertion is the test that documents the
 * invariant.
 */

const stamp = runId();
const newUserEmail = `e2e.user.${stamp}@hrpartner.test`;
const newUserName = `${TEST_PREFIX}Người dùng E2E`;

/** The administrator the suites sign in as. */
const adminEmail = process.env.TEST_ADMIN_EMAIL ?? "";

let temporaryPassword = "";

test.describe.configure({ mode: "serial" });

/**
 * Round 2 promise that round 3 keeps: deleting a user is not a feature.
 * Every page that lists users must NOT expose a delete control of any kind
 * — neither to non-admins (the section is server-side hidden) nor to admins
 * themselves (no app-level delete path). This helper stays around because
 * the test that originally introduced it is the one that documents the
 * invariant; round 3 changes the assertion, not the promise.
 */
async function expectNoDeleteControls(page: Page): Promise<void> {
  const selfRow = page
    .getByTestId("user-row")
    .filter({ hasText: adminEmail })
    .first();
  await expect(selfRow).toBeVisible();

  // No "delete" control on the signed-in user's row.
  await expect(selfRow.getByTestId("user-delete-button-self")).toHaveCount(0);
  // No "delete" control on any other row either.
  await expect(page.getByTestId("user-delete-button")).toHaveCount(0);
  // No "delete" dialog is mounted anywhere on the page.
  await expect(page.getByTestId("delete-user-dialog")).toHaveCount(0);
  // …and no button labelled "delete" in English slipped into the DOM.
  await expect(
    page.getByRole("button", { name: /^delete$/i }),
  ).toHaveCount(0);
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

    await expectNoDeleteControls(page);

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

/**
 * Round 3, part 1 — edit role / active state, and the audit-log page.
 *
 * The flow: an admin creates a throwaway user, edits their role, then opens
 * /admin/logs and finds the new "Đổi vai trò" row. The export button is the
 * only thing not exercised here — it is covered by admin-logs.spec.ts.
 *
 * Note: the app intentionally has no delete-user action. The round 3
 * assertion is the absence of any delete control on every user row, plus
 * the absence of the delete dialog anywhere on the page.
 */

const r3Stamp = runId();
const r3Email = `e2e.r3.${r3Stamp}@hrpartner.test`;
const r3Name = `${TEST_PREFIX}Người dùng R3`;

// `test.describe.configure({ mode: "serial" })` is set once at file scope
// (above) so the round-2 and round-3 describes run their tests in order and
// share the admin's temporary-password state.

test.describe("settings — edit user (round 3, part 1)", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of data?.users ?? []) {
      if (user.email !== r3Email) continue;
      await admin.from("profiles").delete().eq("id", user.id);
      await admin.auth.admin.deleteUser(user.id);
    }
    await sweep(admin);
  });

  test("the admin sees an Edit button on each row, and no delete control", async ({
    page,
  }) => {
    await login(page);
    await gotoAndSettle(page, "/settings");

    const section = page.getByTestId("user-management-section");
    await expect(section).toBeVisible();

    // The admin's own row is listed; it carries the Edit button and nothing
    // destructive. The promise "the app has no delete-user action" is part
    // of the product contract; this is the test that documents it.
    const selfRow = page
      .getByTestId("user-row")
      .filter({ hasText: adminEmail });
    await expect(selfRow).toBeVisible();
    await expect(selfRow.getByTestId("user-edit-button")).toBeVisible();

    await expect(page.getByTestId("user-delete-button")).toHaveCount(0);
    await expect(page.getByTestId("user-delete-button-self")).toHaveCount(0);
    await expect(page.getByTestId("delete-user-dialog")).toHaveCount(0);
  });

  test("a non-admin does not see the Edit button in Settings", async () => {
    // The settings block is only rendered for admins (server-side), so the
    // button has nothing to attach to. We rely on the round-2 suite for
    // the "non-admin does not see the section" assertion; this case is
    // here to keep the suite self-describing.
    test.skip(true, "covered by the round-2 'does not see the section' case");
  });

  test("creates a throwaway user and edits their role", async ({ page }) => {
    test.setTimeout(180_000);

    await login(page);
    await gotoAndSettle(page, "/settings");

    // --- create ---------------------------------------------------------
    await clickSafe(page, '[data-testid="add-user-button"]');
    await expect(page.getByTestId("add-user-dialog")).toBeVisible();
    await page.fill("#newUserEmail", r3Email);
    await page.fill("#newUserFullName", r3Name);
    await clickSafe(page, '[data-testid="add-user-submit"]');

    await expect(page.getByTestId("temporary-password-warning")).toBeVisible();
    await clickSafe(page, '[data-testid="close-temporary-password"]');
    await expect(page.getByTestId("add-user-dialog")).toBeHidden({
      timeout: 15_000,
    });

    const row = page.getByTestId("user-row").filter({ hasText: r3Email });
    await expect(row).toBeVisible();

    // --- edit role ------------------------------------------------------
    await row.getByTestId("user-edit-button").click();
    await expect(page.getByTestId("edit-user-dialog")).toBeVisible();

    // Promote to admin.
    await clickSafe(page, '[data-testid="edit-user-role"]');
    await clickSafe(page, '[role="option"]:has-text("Quản trị viên")');
    await clickSafe(page, '[data-testid="edit-user-submit"]');
    await expect(page.getByTestId("edit-user-dialog")).toBeHidden({
      timeout: 15_000,
    });

    // The row's badge is now "Quản trị viên".
    await expect(row).toContainText("Quản trị viên");
  });

  test("the admin log page lists the new edit event", async ({ page }) => {
    test.setTimeout(60_000);

    await login(page);
    await gotoAndSettle(page, "/admin/logs");

    await expect(
      page.getByRole("heading", { name: "Nhật ký quản trị", level: 1 }),
    ).toBeVisible();

    // The page renders the table; the edit event from the previous test is
    // the most recent one, but the suite does not assume ordering: it just
    // asserts the row exists somewhere on the page.
    await expect(
      page.locator("body").filter({ hasText: "Đổi vai trò" }).first(),
    ).toBeVisible();
  });

  test("a non-admin is redirected away from /admin/logs", async () => {
    // The proxy / page redirect chain refuses non-admins. We exercise it by
    // creating a non-admin user and signing in as them. Skipped in this
    // serial describe to keep the cleanup story simple; the assertion lives
    // in admin-logs.spec.ts.
    test.skip(true, "covered by admin-logs.spec.ts");
  });
});
