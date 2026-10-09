import { expect, test } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  runId,
  seedPartner,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 30 — the client-side column filters on the partners list + the removed
 * "Cập nhật lúc" column.
 */

const HRP = "00000000-0000-4000-8000-000000000001";
const HR_VN = "00000000-0000-4000-8000-000000000002";

const stamp = runId();

test.describe("partners column filters (round 30)", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("filters by name, abbreviation, region and company", async ({ page }) => {
    test.setTimeout(180_000);

    const admin = adminClient();
    const nameA = `${TEST_PREFIX}Điện tử Thiên Quang ${stamp}`;
    const nameB = `${TEST_PREFIX}Cơ khí Hà Nội ${stamp}`;
    const nameC = `${TEST_PREFIX}Điện tử Miền Bắc ${stamp}`;

    const partnerA = await seedPartner(admin, {
      organizationId: ORG_A,
      name: nameA,
    });
    const partnerB = await seedPartner(admin, {
      organizationId: ORG_A,
      name: nameB,
    });
    const partnerC = await seedPartner(admin, {
      organizationId: ORG_A,
      name: nameC,
    });

    await admin.from("partners").update({ region: "Miền Bắc", abbreviation: "ĐTQ" }).eq("id", partnerA.id);
    await admin.from("partners").update({ region: "Miền Nam", abbreviation: "CKH" }).eq("id", partnerB.id);
    await admin.from("partners").update({ region: "Miền Bắc" }).eq("id", partnerC.id);

    await admin.from("partner_companies").insert([
      { partner_id: partnerA.id, company_id: HRP },
      { partner_id: partnerB.id, company_id: HR_VN },
      { partner_id: partnerC.id, company_id: HRP },
    ]);

    await login(page);
    await gotoAndSettle(page, "/partners");

    const rowWith = (name: string) =>
      page.getByTestId("partner-row").filter({ hasText: name });

    await expect(rowWith(nameA)).toBeVisible({ timeout: 30_000 });
    await expect(rowWith(nameB)).toBeVisible();
    await expect(rowWith(nameC)).toBeVisible();

    // The "Cập nhật lúc" column is gone.
    await expect(page.getByText("Cập nhật lúc")).toHaveCount(0);

    // Name filter — folded contains ("thiên quang" matches "Thiên Quang").
    await page.getByTestId("partner-filter-name").fill("thiên quang");
    await expect(rowWith(nameA)).toBeVisible();
    await expect(rowWith(nameB)).toHaveCount(0);
    await expect(rowWith(nameC)).toHaveCount(0);

    // Abbreviation filter — folded contains.
    await page.getByTestId("partner-filter-name").fill("");
    await page.getByTestId("partner-filter-abbr").fill("ckh");
    await expect(rowWith(nameB)).toBeVisible();
    await expect(rowWith(nameA)).toHaveCount(0);
    await expect(rowWith(nameC)).toHaveCount(0);

    // Region filter — folded contains.
    await page.getByTestId("partner-filter-abbr").fill("");
    await page.getByTestId("partner-filter-region").fill("miền nam");
    await expect(rowWith(nameB)).toBeVisible();
    await expect(rowWith(nameA)).toHaveCount(0);
    await expect(rowWith(nameC)).toHaveCount(0);

    // Company filter — HRP keeps the two HRP partners.
    await page.getByTestId("partner-filter-region").fill("");
    await clickSafe(page, '[data-testid="partner-filter-company"]');
    await page.getByRole("option", { name: "HRP" }).click();
    await expect(rowWith(nameA)).toBeVisible({ timeout: 15_000 });
    await expect(rowWith(nameC)).toBeVisible();
    await expect(rowWith(nameB)).toHaveCount(0);

    // Combined: HRP + region "Miền Bắc" → the two Miền Bắc/HRP partners.
    await page.getByTestId("partner-filter-region").fill("miền bắc");
    await expect(rowWith(nameA)).toBeVisible();
    await expect(rowWith(nameC)).toBeVisible();
    await expect(rowWith(nameB)).toHaveCount(0);

    // A filter that matches nothing shows the empty message.
    await page.getByTestId("partner-filter-name").fill("không tồn tại");
    await expect(page.getByTestId("partners-filter-empty")).toBeVisible();
    await expect(page.getByTestId("partners-filter-empty")).toContainText(
      "Không có đối tác nào khớp bộ lọc",
    );
  });
});
