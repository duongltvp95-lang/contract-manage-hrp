import { expect, test } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  gotoAndSettle,
  isoDate,
  hasLiveBackend,
  login,
  runId,
  seedContracts,
  sweep,
  type SeededContract,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Plan section 100 — Search number, Search partner, Expiry filters, Pagination.
 * Plan sections 48-53 — every piece of list state lives in the URL, and the
 * filtering happens in SQL.
 */

const stamp = runId();
const PAGE_SIZE = 25;
const SEEDED = PAGE_SIZE + 2;

let seeded: SeededContract[] = [];
const expiredNumber = `${TEST_PREFIX}EXPIRED-${stamp}`;
const soonNumber = `${TEST_PREFIX}SOON-${stamp}`;
const partnerNeedle = `Zebra-${stamp}`;

test.describe.configure({ mode: "serial" });

test.describe("contract list", () => {
  test.beforeAll(async () => {
    const admin = adminClient();
    await sweep(admin);

    // Enough rows to force a second page, plus two rows with distinctive dates
    // so the expiry presets have something unambiguous to find.
    const rows = Array.from({ length: SEEDED }, (_, index) => ({
      organizationId: ORG_A,
      contractNumber: `${TEST_PREFIX}PAGE-${stamp}-${String(index).padStart(2, "0")}`,
      partnerText: index === 0 ? partnerNeedle : `Đối tác ${index}`,
      signedDate: isoDate(-400),
      expiryDate: isoDate(200 + index),
    }));

    rows.push({
      organizationId: ORG_A,
      contractNumber: expiredNumber,
      partnerText: "Đối tác đã hết hạn",
      signedDate: isoDate(-800),
      expiryDate: isoDate(-30),
    });

    rows.push({
      organizationId: ORG_A,
      contractNumber: soonNumber,
      partnerText: "Đối tác sắp hết hạn",
      signedDate: isoDate(-30),
      expiryDate: isoDate(20),
    });

    seeded = await seedContracts(admin, rows);
  });

  test.afterAll(async () => {
    for (const contract of seeded) await contract.cleanup();
    await sweep(adminClient());
  });

  test("searches by contract number", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/contracts");
    // `soonNumber` is still active; `expiredNumber` lives on the expired tab
    // (round 20), so a search from the active list must not return it.
    await page.fill('input[name="q"]', soonNumber);
    await page.locator('form button[type="submit"]').click();

    await expect(page).toHaveURL(new RegExp(`q=${soonNumber}`));
    const body = page.locator("body");
    await expect(body).toContainText(soonNumber);
    await expect(body).not.toContainText(expiredNumber);
    await expect(body).toContainText("1 hợp đồng");
  });

  test("searches by partner name", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/contracts");
    await page.fill('input[name="q"]', partnerNeedle);
    await page.locator('form button[type="submit"]').click();

    const body = page.locator("body");
    await expect(body).toContainText(partnerNeedle);
    await expect(body).toContainText(`${TEST_PREFIX}PAGE-${stamp}-00`);
  });

  test("a search with no matches shows the empty state, not a blank table", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts?q=${TEST_PREFIX}definitely-nothing-${stamp}`);

    const body = page.locator("body");
    await expect(body).toContainText("Không tìm thấy hợp đồng phù hợp");
    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
  });

  test("the expired tab returns only expired contracts", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/contracts?scope=expired");

    const body = page.locator("body");
    await expect(body).toContainText(expiredNumber);
    await expect(body).not.toContainText(soonNumber);
  });

  test("the expiring-90 filter finds a contract 20 days out and not an expired one", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/contracts");

    await page.locator("#preset").click();
    await page.getByRole("option", { name: "Hết hạn trong 90 ngày" }).click();

    await expect(page).toHaveURL(/preset=expiring90/);
    const body = page.locator("body");
    await expect(body).toContainText(soonNumber);
    await expect(body).not.toContainText(expiredNumber);
  });

  test("paginates the seeded rows", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts?q=${TEST_PREFIX}PAGE-${stamp}`);

    const body = page.locator("body");
    await expect(body).toContainText(`trong ${SEEDED} hợp đồng`);
    await expect(body).toContainText("Trang 1/2");
    await expect(body).toContainText(`Hiển thị 1–${PAGE_SIZE}`);

    // The first row of page 2 is the 26th record.
    await page.getByRole("button", { name: /Sau/ }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(body).toContainText("Trang 2/2");
    await expect(body).toContainText(`Hiển thị ${PAGE_SIZE + 1}–${SEEDED}`);

    await page.getByRole("button", { name: /Trước/ }).click();
    await expect(page).toHaveURL(/page=1|contracts\?q=/);
    await expect(body).toContainText("Trang 1/2");
  });

  test("keeps the filter when changing the page size", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts?q=${TEST_PREFIX}PAGE-${stamp}&page=2`);

    await page.locator("#pageSize").click();
    await page.getByRole("option", { name: "50" }).click();

    // Changing the page size resets to page 1 but must not lose the search.
    await expect(page).toHaveURL(/pageSize=50/);
    await expect(page).not.toHaveURL(/page=2/);
    const body = page.locator("body");
    await expect(body).toContainText("Trang 1/1");
    await expect(body).toContainText(`trong ${SEEDED} hợp đồng`);
  });

  test("sorts by a sortable column", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/contracts?q=${TEST_PREFIX}PAGE-${stamp}`);

    await page.getByRole("link", { name: /Ngày ký/ }).click();
    await expect(page).toHaveURL(/sort=signed_date/);
    await expect(page).toHaveURL(/dir=asc/);
  });

  test("clears every filter in one click", async ({ page }) => {
    await login(page);
    // A filter combo that still matches (no empty state, so only the toolbar's
    // "Xoá bộ lọc" link exists). `preset=expired` is gone since round 20 — the
    // expired tab replaced it.
    await gotoAndSettle(page, `/contracts?q=${soonNumber}&preset=expiring90`);

    await page.getByRole("link", { name: /Xoá bộ lọc/ }).click();
    await expect(page).toHaveURL(/\/contracts$/);
  });
});
