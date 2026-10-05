import { expect, test, type Page } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  clickSafe,
  dmy,
  gotoAndSettle,
  hasLiveBackend,
  isoDate,
  login,
  pickDate,
  runId,
  selectPartner,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Feature round 2, part 2 — the partner flow, end to end.
 *
 * add → appears in the list → create a contract that selects it → the contract
 * shows the partner's name → the partner page lists that contract → rename and
 * the new name follows everywhere.
 *
 * Every screen is also checked for a delete control of any kind: a partner is
 * referenced by contracts and the owner's rule is that no delete path exists —
 * not in the UI, not in the API, not in RLS.
 */

const stamp = runId();
const partnerName = `${TEST_PREFIX}Đối tác luồng ${stamp}`;
const renamedName = `${TEST_PREFIX}Đối tác đã đổi tên ${stamp}`;
const contractNumber = `${TEST_PREFIX}PARTNER-${stamp}`;

let partnerId = "";
let contractId = "";

test.describe.configure({ mode: "serial" });

/**
 * Asserts that nothing on the page offers to delete a partner.
 *
 * Both Vietnamese spellings are checked ("xoá" and "xóa"), and both a button and
 * a menu item, because a delete could hide behind the actions menu.
 */
async function expectNoDeleteControl(page: Page): Promise<void> {
  const deleteish = /(xoá|xóa|delete)/i;

  await expect(page.getByRole("button", { name: deleteish })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: deleteish })).toHaveCount(0);
  await expect(page.getByRole("link", { name: deleteish })).toHaveCount(0);
  await expect(page.locator('[data-testid*="delete"]')).toHaveCount(0);
}

test.describe("partner flow", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    // Contracts first, then the partner they point at (ON DELETE RESTRICT).
    const admin = adminClient();
    await sweep(admin);

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("organization_id", ORG_A)
      .in("name", [partnerName, renamedName]);

    for (const row of data ?? []) {
      await admin.from("partners").delete().eq("id", row.id);
    }
  });

  test("adds a partner and shows it in the list", async ({ page }) => {
    await login(page);

    // The sidebar carries the new item, in the owner's order.
    await expect(page.getByRole("link", { name: "Đối tác" })).toBeVisible();

    await gotoAndSettle(page, "/partners");
    await expect(page.getByRole("heading", { name: "Đối tác", level: 1 })).toBeVisible();

    // Empty state before anything exists. Asserted only when the directory is
    // genuinely empty: the suite sweeps its own rows, but a partner the owner
    // added by hand would legitimately be on screen too.
    if ((await page.getByTestId("partner-row").count()) === 0) {
      await expect(page.locator("body")).toContainText("Chưa có đối tác");
      // Two add buttons on purpose: one in the page header, one in the empty
      // state. Either is the same control.
      await expect(page.getByTestId("partner-add-button").first()).toBeVisible();
    }

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerName", partnerName);
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    // The list refreshed and shows the new partner with a zero contract count.
    const row = page.getByTestId("partner-row").filter({ hasText: partnerName });
    await expect(row).toBeVisible();
    await expect(row).toContainText("0");

    await expectNoDeleteControl(page);

    const { data } = await adminClient()
      .from("partners")
      .select("id, name, organization_id")
      .eq("name", partnerName)
      .single();

    expect(data?.organization_id).toBe(ORG_A);
    partnerId = data?.id ?? "";
    expect(partnerId).not.toBe("");
  });

  test("creates a contract that selects the new partner", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/contracts/new");

    const expiry = isoDate(30);
    await page.fill('input[name="contractNumber"]', contractNumber);

    // The partner field is a searchable combobox fed by the directory.
    await selectPartner(page, partnerName);
    await expect(page.getByTestId("partner-combobox")).toContainText(partnerName);

    await clickSafe(page, "#expiryDate");
    await pickDate(page, expiry);

    await clickSafe(page, '[data-testid="contract-form-submit"]');
    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 90_000 });

    contractId = page.url().split("/").pop() as string;

    const admin = adminClient();
    const { data } = await admin
      .from("contracts")
      .select("partner_id, partner_text")
      .eq("id", contractId)
      .single();

    expect(data?.partner_id).toBe(partnerId);
    // A new contract carries the link, not free text.
    expect(data?.partner_text).toBeNull();

    // The detail panel shows the partner by name.
    await expect(page.locator("body")).toContainText(partnerName);
    await expect(page.locator("body")).toContainText(dmy(expiry));
  });

  test("the partner page lists that contract", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/partners/${partnerId}`);

    await expect(page.getByTestId("partner-detail-name")).toHaveText(partnerName);
    await expect(page.locator("body")).toContainText(contractNumber);

    await expectNoDeleteControl(page);
  });

  test("the contracts list shows the partner name in its column", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts?q=${encodeURIComponent(contractNumber)}`);

    const row = page.getByRole("row").filter({ hasText: contractNumber });
    await expect(row).toContainText(partnerName);
  });

  test("renames the partner and the new name follows everywhere", async ({ page }) => {
    await login(page);

    // From the partner list.
    await gotoAndSettle(page, "/partners");
    const row = page.getByTestId("partner-row").filter({ hasText: partnerName });
    await row.getByTestId("partner-rename-button").click();

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();
    await page.fill("#partnerName", renamedName);
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("partner-row").filter({ hasText: renamedName }),
    ).toBeVisible();

    // The contract is linked, so it shows the new name without being edited.
    await gotoAndSettle(page, `/contracts/${contractId}`);
    await expect(page.locator("body")).toContainText(renamedName);
    await expect(page.locator("body")).not.toContainText(partnerName);

    // …and so does the partner's own page.
    await gotoAndSettle(page, `/partners/${partnerId}`);
    await expect(page.getByTestId("partner-detail-name")).toHaveText(renamedName);

    const { data } = await adminClient()
      .from("partners")
      .select("name")
      .eq("id", partnerId)
      .single();

    expect(data?.name).toBe(renamedName);
  });

  test("a partner that does not exist shows the not-found page", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/partners/${crypto.randomUUID()}`);

    // The status is deliberately not asserted — see M8 deviation 12: with
    // `cacheComponents` Next has flushed the shell as 200 before `notFound()`
    // runs. The outcome is what must hold.
    await expect(page.locator("body")).toContainText("This page could not be found");
    await expect(page.getByTestId("partner-detail-name")).toHaveCount(0);
  });

  test("creates a partner from inside the contract form and selects it", async ({ page }) => {
    const inlineName = `${TEST_PREFIX}Đối tác tạo trong form ${stamp}`;

    await login(page);
    await gotoAndSettle(page, "/contracts/new");

    // The "+ Thêm đối tác" action lives inside the combobox, and the reason to
    // use it is almost always "because I need it for this contract".
    await clickSafe(page, '[data-testid="partner-combobox"]');
    await clickSafe(page, '[data-testid="partner-combobox-add"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();
    await page.fill("#partnerName", inlineName);
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    // Selected immediately, without reopening the combobox.
    await expect(page.getByTestId("partner-combobox")).toContainText(inlineName);

    const { data } = await adminClient()
      .from("partners")
      .select("id, organization_id")
      .eq("name", inlineName)
      .maybeSingle();

    expect(data?.organization_id).toBe(ORG_A);

    // `afterAll` sweeps it: the name carries the test prefix.
  });
});
