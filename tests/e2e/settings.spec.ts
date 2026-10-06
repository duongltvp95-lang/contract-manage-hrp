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
 * Round 4 re-opens the delete path. The "no delete" promise from round 3
 * is reversed; this file documents the new contract. Non-admins still do
 * not see the section at all (server-side guard), but admins now see
 * Edit + Delete on every row except their own.
 */

const stamp = runId();
const newUserEmail = `e2e.user.${stamp}@hrpartner.test`;
const newUserName = `${TEST_PREFIX}Người dùng E2E`;

/** The administrator the suites sign in as. */
const adminEmail = process.env.TEST_ADMIN_EMAIL ?? "";

let temporaryPassword = "";

test.describe.configure({ mode: "serial" });

/**
 * Round 4 promise: every page that lists users exposes both Edit and
 * Delete controls to the administrator, and the self row carries a
 * disabled Delete with a Vietnamese tooltip. Non-admins do not see the
 * section at all (server-side guard).
 *
 * The helper below replaces round 3's `expectNoDeleteControls`. The
 *   `data-testid`s and the dialog shape are unchanged from the round 3
 * pre-revert design, so the Playwright locators stay identical.
 */
async function expectAdminSeesEditAndDeleteControls(page: Page): Promise<void> {
  const selfRow = page
    .getByTestId("user-row")
    .filter({ hasText: adminEmail })
    .first();
  await expect(selfRow).toBeVisible();

  // The signed-in user's own row keeps a disabled delete (with tooltip) and
  // a real Edit button.
  await expect(selfRow.getByTestId("user-edit-button")).toBeVisible();
  await expect(selfRow.getByTestId("user-delete-button-self")).toBeVisible();
  // The standard "user-delete-button" must NOT be present on the self row.
  await expect(selfRow.getByTestId("user-delete-button")).toHaveCount(0);

  // At least one non-self row carries the standard Delete button.
  const deleteCount = await page.getByTestId("user-delete-button").count();
  expect(deleteCount).toBeGreaterThan(0);

  // …and no English-only "delete" button slipped into the DOM.
  await expect(
    page.getByRole("button", { name: /^delete$/i }),
  ).toHaveCount(0);
}

test.describe("settings — user management", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    // Test cleanup through the service role. The product has a delete-user
    // feature in this round; the suite still must not leave accounts
    // behind for the next run.
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

    await expectAdminSeesEditAndDeleteControls(page);

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
 * Round 4 adds the delete flow on top. The Edit path is unchanged; the
 * audit-log assertion is kept (it is what the delete flow writes a row for
 * too).
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

  test("the admin sees Edit and Delete controls on every row", async ({ page }) => {
    // Round 4 re-introduces the Delete button. The "self row carries a
    // disabled delete + tooltip" and "other rows carry a real delete button"
    // shapes are documented by the helper above; this test re-runs the
    // round 3 "the admin sees a row" path with the new expectations in
    // scope.
    await login(page);
    await gotoAndSettle(page, "/settings");

    const section = page.getByTestId("user-management-section");
    await expect(section).toBeVisible();

    await expectAdminSeesEditAndDeleteControls(page);
  });

  test("a non-admin does not see Edit or Delete buttons in Settings", async () => {
    // The settings block is only rendered for admins (server-side), so the
    // buttons have nothing to attach to. We rely on the round-2 suite for
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

/**
 * Round 4, part 1 — admin hard delete.
 *
 * The flow: an admin creates a throwaway user, opens the delete dialog,
 * re-types the user's email as confirmation, submits, and the row is
 * gone. The dialog is the same shape as the round 3 pre-revert design,
 * so the locators match the older suite.
 *
 * The self-row assertion is separate: the button there is disabled, but
 * clicking the *self-row edit* is fine — the assertion is on the
 * `user-delete-button-self` state, not on a service call.
 */

const r4Stamp = runId();
const r4Email = `e2e.r4.${r4Stamp}@hrpartner.test`;
const r4Name = `${TEST_PREFIX}Người dùng R4`;

test.describe("settings — delete user (round 4, part 1)", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of data?.users ?? []) {
      if (user.email !== r4Email) continue;
      await admin.from("profiles").delete().eq("id", user.id);
      await admin.auth.admin.deleteUser(user.id);
    }
    await sweep(admin);
  });

  test("admin can delete a non-self user (round 4)", async ({ page }) => {
    test.setTimeout(180_000);

    await login(page);
    await gotoAndSettle(page, "/settings");

    // --- create the throwaway ------------------------------------------
    await clickSafe(page, '[data-testid="add-user-button"]');
    await expect(page.getByTestId("add-user-dialog")).toBeVisible();
    await page.fill("#newUserEmail", r4Email);
    await page.fill("#newUserFullName", r4Name);
    await clickSafe(page, '[data-testid="add-user-submit"]');
    await expect(page.getByTestId("temporary-password-warning")).toBeVisible();
    await clickSafe(page, '[data-testid="close-temporary-password"]');
    await expect(page.getByTestId("add-user-dialog")).toBeHidden({
      timeout: 15_000,
    });

    const row = page.getByTestId("user-row").filter({ hasText: r4Email });
    await expect(row).toBeVisible();

    // --- open the delete dialog ----------------------------------------
    await row.getByTestId("user-delete-button").click();
    await expect(page.getByTestId("delete-user-dialog")).toBeVisible();
    await expect(page.getByTestId("delete-user-warning")).toBeVisible();

    // The submit button is disabled until the typed email matches.
    await expect(page.getByTestId("delete-user-submit")).toBeDisabled();

    // Wrong email keeps it disabled.
    await page.fill(
      '[data-testid="delete-user-confirm-email"]',
      "wrong@hrpartner.test",
    );
    await expect(page.getByTestId("delete-user-submit")).toBeDisabled();

    // The right email enables it.
    await page.fill('[data-testid="delete-user-confirm-email"]', r4Email);
    await expect(page.getByTestId("delete-user-submit")).toBeEnabled();

    await clickSafe(page, '[data-testid="delete-user-submit"]');
    await expect(page.getByTestId("delete-user-dialog")).toBeHidden({
      timeout: 15_000,
    });

    // The row is gone.
    await expect(
      page.getByTestId("user-row").filter({ hasText: r4Email }),
    ).toHaveCount(0);
  });

  test("the admin's own row carries a disabled delete (cannot self-delete)", async ({
    page,
  }) => {
    // The disabled delete with a Vietnamese tooltip is the UI surface for
    // the service's self-delete refusal. The form is disabled, so the
    // submit path is not reachable from the browser, but the test still
    // documents the visible contract.
    await login(page);
    await gotoAndSettle(page, "/settings");

    const selfRow = page
      .getByTestId("user-row")
      .filter({ hasText: adminEmail });
    await expect(selfRow).toBeVisible();

    const selfDelete = selfRow.getByTestId("user-delete-button-self");
    await expect(selfDelete).toBeVisible();
    await expect(selfDelete).toBeDisabled();
  });
});
