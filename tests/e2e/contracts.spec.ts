import { expect, test } from "@playwright/test";

import {
  TEST_PREFIX,
  adminClient,
  clickSafe,
  dmy,
  isoDate,
  hasLiveBackend,
  login,
  pickDate,
  runId,
  setInput,
  sweep,
  gotoAndSettle,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Plan section 100 — Create contract, Edit contract, Archive contract.
 * Plan sections 65, 66 — the edit Sheet reuses the form; archiving is a soft
 * delete with a confirmation step.
 */

const stamp = runId();
const created: string[] = [];

test.describe.configure({ mode: "serial" });

test.describe("contract lifecycle", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("creates a contract through the form", async ({ page }) => {
    const contractNumber = `${TEST_PREFIX}CREATE-${stamp}`;
    const expiry = isoDate(45);

    await login(page);
    await gotoAndSettle(page, "/contracts/new");

    await page.fill('input[name="contractNumber"]', contractNumber);
    await page.fill('input[name="partnerText"]', "Công ty TNHH Samsung Electronics Việt Nam");
    await page.fill('input[name="durationText"]', "12 tháng");
    await page.fill('textarea[name="notes"]', "Tạo bởi bộ kiểm thử tự động");

    await clickSafe(page, "#expiryDate");
    await pickDate(page, expiry);

    await clickSafe(page, '[data-testid="contract-form-submit"]');
    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    const id = page.url().split("/").pop() as string;
    created.push(id);

    const admin = adminClient();
    const { data } = await admin
      .from("contracts")
      .select("contract_number, partner_text, expiry_date, archived_at")
      .eq("id", id)
      .single();

    expect(data?.contract_number).toBe(contractNumber);
    expect(data?.partner_text).toBe("Công ty TNHH Samsung Electronics Việt Nam");
    expect(data?.expiry_date).toBe(expiry);
    expect(data?.archived_at).toBeNull();

    // The detail page reflects what was saved.
    await expect(page.getByRole("heading", { name: contractNumber })).toBeVisible();
    await expect(page.getByText(dmy(expiry), { exact: false }).first()).toBeVisible();
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
    await setInput(page, 'input[name="partnerText"]', "Đối tác đã sửa");

    await clickSafe(page, '[data-testid="contract-form-submit"]');
    await expect(page.locator('[data-testid="edit-contract-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    const admin = adminClient();
    const { data } = await admin
      .from("contracts")
      .select("expiry_date, partner_text")
      .eq("id", id)
      .single();

    expect(data?.expiry_date).toBe(newExpiry);
    expect(data?.partner_text).toBe("Đối tác đã sửa");

    // Detail shows the new values without a manual reload.
    await page.reload();
    const detail = page.locator("body");
    await expect(detail).toContainText(dmy(newExpiry));
    await expect(detail).toContainText("Đối tác đã sửa");

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
});
