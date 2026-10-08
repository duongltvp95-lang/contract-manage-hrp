import { expect, test } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  clickSafe,
  dmy,
  isoDate,
  hasLiveBackend,
  login,
  pickDate,
  runId,
  seedPartner,
  selectPartner,
  sweep,
  gotoAndSettle,
  type SeededPartner,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Plan section 100 — Create contract, Edit contract, Archive contract.
 * Plan sections 65, 66 — the edit Sheet reuses the form; archiving is a soft
 * delete with a confirmation step.
 */

const stamp = runId();
const created: string[] = [];

/**
 * Two partners for the lifecycle: one to create the contract with, one to move
 * it to when the edit test changes the partner (feature round 2).
 */
let partnerA: SeededPartner;
let partnerB: SeededPartner;

test.describe.configure({ mode: "serial" });

test.describe("contract lifecycle", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    await sweep(admin);

    partnerA = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Đối tác tạo mới ${stamp}`,
    });
    partnerB = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Đối tác đổi sang ${stamp}`,
    });
  });

  test.afterAll(async () => {
    const admin = adminClient();
    // Contracts first, then the partners they point at (ON DELETE RESTRICT).
    await sweep(admin);
    await partnerA?.cleanup();
    await partnerB?.cleanup();
  });

  test("creates a contract through the form", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}CREATE-${stamp}`;
    const expiry = isoDate(45);

    await login(page);
    await gotoAndSettle(page, "/contracts/new");

    await page.fill('input[name="contractNumber"]', contractNumber);
    // A new contract must name a partner (feature round 2); the free-text field
    // is gone from the create form.
    await selectPartner(page, partnerA.name);
    await page.fill('input[name="durationText"]', "12 tháng");

    await clickSafe(page, "#expiryDate");
    await pickDate(page, expiry);

    await clickSafe(page, '[data-testid="contract-form-submit"]');
    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    const id = page.url().split("/").pop() as string;
    created.push(id);

    const admin = adminClient();
    const { data } = await admin
      .from("contracts")
      .select("contract_number, partner_id, partner_text, expiry_date, archived_at")
      .eq("id", id)
      .single();

    expect(data?.contract_number).toBe(contractNumber);
    expect(data?.partner_id).toBe(partnerA.id);
    expect(data?.expiry_date).toBe(expiry);
    expect(data?.archived_at).toBeNull();

    // The detail page reflects what was saved — including the partner, which is
    // resolved through the link rather than the old free-text column.
    await expect(page.getByRole("heading", { name: contractNumber })).toBeVisible();
    await expect(page.getByText(dmy(expiry), { exact: false }).first()).toBeVisible();
    await expect(page.locator("body")).toContainText(partnerA.name);
  });

  test("edits the expiry date from the detail Sheet and the list follows", async ({ page }) => {
    const id = created[0];
    const contractNumber = `${TEST_PREFIX}CREATE-${stamp}`;
    const newExpiry = isoDate(-10);

    await login(page);
    await gotoAndSettle(page, `/contracts/${id}`);

    await clickSafe(page, '[data-testid="contract-edit-button"]');
    await expect(page.locator('[data-testid="edit-contract-sheet"]')).toBeVisible();

    // The shared form arrives pre-filled — it is the same component as create.
    await expect(page.locator('input[name="contractNumber"]')).toHaveValue(contractNumber);

    await clickSafe(page, "#expiryDate");
    await pickDate(page, newExpiry);
    // The calendar stays open after picking (the DateField popover is controlled),
    // and would otherwise swallow the first click on the partner combobox.
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="calendar"]')).toBeHidden();
    // Change the partner too: the edit path must allow re-pointing a contract.
    await selectPartner(page, partnerB.name);

    await clickSafe(page, '[data-testid="contract-form-submit"]');
    await expect(page.locator('[data-testid="edit-contract-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    const admin = adminClient();
    const { data } = await admin
      .from("contracts")
      .select("expiry_date, partner_id")
      .eq("id", id)
      .single();

    expect(data?.expiry_date).toBe(newExpiry);
    expect(data?.partner_id).toBe(partnerB.id);

    // Detail shows the new values without a manual reload.
    await page.reload();
    const detail = page.locator("body");
    await expect(detail).toContainText(dmy(newExpiry));
    await expect(detail).toContainText(partnerB.name);
    await expect(detail).not.toContainText(partnerA.name);

    // And so does the list.
    await gotoAndSettle(page, `/contracts?q=${encodeURIComponent(contractNumber)}`);
    await expect(page.locator("body")).toContainText(dmy(newExpiry));
  });

  test("archives the contract behind a confirmation and hides it everywhere", async ({ page }) => {
    const id = created[0];
    const contractNumber = `${TEST_PREFIX}CREATE-${stamp}`;

    await login(page);
    await gotoAndSettle(page, `/contracts/${id}`);

    await clickSafe(page, '[data-testid="contract-more-button"]');
    await clickSafe(page, '[data-testid="contract-archive-menu-item"]');

    const dialog = page.locator('[data-testid="archive-confirm-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("ẩn khỏi danh sách");

    await clickSafe(page, '[data-testid="archive-confirm-button"]');
    await page.waitForURL(/\/contracts$/, { timeout: 30_000 });

    const admin = adminClient();
    const { data } = await admin
      .from("contracts")
      .select("id, archived_at")
      .eq("id", id)
      .maybeSingle();

    // Soft delete: the row survives, stamped.
    expect(data?.id).toBe(id);
    expect(data?.archived_at).not.toBeNull();

    await gotoAndSettle(page, `/contracts?q=${encodeURIComponent(contractNumber)}`);
    await expect(page.locator("body")).toContainText("Không tìm thấy hợp đồng phù hợp");

    await gotoAndSettle(page, "/dashboard");
    await expect(page.locator("body")).not.toContainText(contractNumber);

    // Still reachable by direct link, clearly marked, and no longer editable.
    await gotoAndSettle(page, `/contracts/${id}`);
    await expect(page.locator('[data-testid="contract-archived-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="contract-edit-button"]')).toHaveCount(0);
  });

  test("validates the form before saving", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/contracts/new");

    await page.fill('input[name="contractNumber"]', "x".repeat(101));
    await clickSafe(page, '[data-testid="contract-form-submit"]');

    // Still on the form, with a field-level message rather than a crash.
    await expect(page).toHaveURL(/\/contracts\/new/);
    await expect(page.locator("body")).toContainText("tối đa 100 ký tự");
  });

  test("a contract that does not exist shows the not-found page, not an empty one", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts/${crypto.randomUUID()}`);

    // The status is deliberately NOT asserted. `notFound()` fires after Next has
    // flushed the Partial Prerender shell, so a production build answers 200
    // with the not-found page while `next dev` answers 404 — asserting the code
    // would make this suite pass locally and fail against a real deployment.
    // See docs/milestones/M8, deviation 12. What must hold is the outcome.
    await expect(page.locator("body")).toContainText("This page could not be found");
    await expect(page.locator('[data-testid="document-selector"]')).toHaveCount(0);
  });

  test("shows the company badges on the contracts list (round 18)", async ({ page }) => {
    const stamp2 = runId();
    const admin = adminClient();
    const contractNumber = `${TEST_PREFIX}HD công ty ${stamp2}`;

    // A partner linked to both companies + one contract pointing at it.
    const { data: partner } = await admin
      .from("partners")
      .insert({ organization_id: ORG_A, name: `${TEST_PREFIX}Đối tác công ty ${stamp2}` })
      .select("id")
      .single();
    const partnerId = partner?.id as string;
    expect(partnerId).toBeTruthy();

    await admin.from("partner_companies").insert([
      { partner_id: partnerId, company_id: "00000000-0000-4000-8000-000000000001" },
      { partner_id: partnerId, company_id: "00000000-0000-4000-8000-000000000002" },
    ]);

    await admin.from("contracts").insert({
      organization_id: ORG_A,
      contract_number: contractNumber,
      partner_id: partnerId,
    });

    await login(page);
    await gotoAndSettle(page, "/contracts");

    const row = page.getByRole("row").filter({ hasText: contractNumber });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Two company badges (HRP + HR VN), no em-dash.
    await expect(row.getByTestId("partner-company-badge")).toHaveCount(2);
    await expect(
      row.getByTestId("partner-company-badge").filter({ hasText: "HRP" }),
    ).toBeVisible();
    await expect(
      row.getByTestId("partner-company-badge").filter({ hasText: "HR VN" }),
    ).toBeVisible();
  });
});
