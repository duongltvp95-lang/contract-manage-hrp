import { expect, test } from "@playwright/test";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  gotoAndSettle,
  hasLiveBackend,
  login,
  runId,
  seedPartner,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 30 / Round 37 — the client-side column filters on the partners list.
 *
 * Round 30 used four text inputs (name / abbreviation / region / company).
 * Round 37 swaps each input for an Excel-style column filter popover:
 * search + multi-select checkboxes. The behaviour is otherwise the same —
 * folded text match for the textual columns, exact match for company. AND
 * between columns.
 */

const HRP = "00000000-0000-4000-8000-000000000001";
const HR_VN = "00000000-0000-4000-8000-000000000002";

const stamp = runId();

/**
 * Open the popover for the given testid prefix, optionally type into its
 * search box, optionally click a checkbox by option value, then close.
 */
async function openPopover(
  page: import("@playwright/test").Page,
  prefix: string,
) {
  await page.getByTestId(`${prefix}-trigger`).click();
  await expect(page.getByTestId(`${prefix}-popover`)).toBeVisible();
}

async function checkOption(
  page: import("@playwright/test").Page,
  prefix: string,
  value: string,
) {
  await page.getByTestId(`${prefix}-option-${value}`).click();
}

async function closePopover(
  page: import("@playwright/test").Page,
) {
  await page.keyboard.press("Escape");
}

test.describe("partners column filters (round 37)", () => {
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
    // The popover is single-row per option, so we pick the exact name.
    await openPopover(page, "partner-filter-name");
    await checkOption(page, "partner-filter-name", nameA);
    await closePopover(page);
    await expect(rowWith(nameA)).toBeVisible();
    await expect(rowWith(nameB)).toHaveCount(0);
    await expect(rowWith(nameC)).toHaveCount(0);

    // Clear via the chip strip's "×" on the name filter (no global clear here
    // because we are about to layer another filter).
    await page.getByTestId("partners-active-filter-name").getByRole("button").click();

    // Abbreviation filter — exact match on the "ĐTQ" / "CKH" token.
    await openPopover(page, "partner-filter-abbr");
    await checkOption(page, "partner-filter-abbr", "CKH");
    await closePopover(page);
    await expect(rowWith(nameB)).toBeVisible();
    await expect(rowWith(nameA)).toHaveCount(0);
    await expect(rowWith(nameC)).toHaveCount(0);

    await page.getByTestId("partners-active-filter-shortName").getByRole("button").click();

    // Region filter — exact match on "Miền Nam" / "Miền Bắc".
    await openPopover(page, "partner-filter-region");
    await checkOption(page, "partner-filter-region", "Miền Nam");
    await closePopover(page);
    await expect(rowWith(nameB)).toBeVisible();
    await expect(rowWith(nameA)).toHaveCount(0);
    await expect(rowWith(nameC)).toHaveCount(0);

    await page.getByTestId("partners-active-filter-region").getByRole("button").click();

    // Company filter — HRP keeps the two HRP partners.
    await openPopover(page, "partner-filter-company");
    await checkOption(page, "partner-filter-company", "HRP");
    await closePopover(page);
    await expect(rowWith(nameA)).toBeVisible({ timeout: 15_000 });
    await expect(rowWith(nameC)).toBeVisible();
    await expect(rowWith(nameB)).toHaveCount(0);

    // Combined: HRP + region "Miền Bắc" → the two Miền Bắc/HRP partners.
    await openPopover(page, "partner-filter-region");
    await checkOption(page, "partner-filter-region", "Miền Bắc");
    await closePopover(page);
    await expect(rowWith(nameA)).toBeVisible();
    await expect(rowWith(nameC)).toBeVisible();
    await expect(rowWith(nameB)).toHaveCount(0);

    // "Xoá tất cả filter" wipes everything and the empty state goes away.
    await page.getByTestId("partners-clear-filters").click();
    await expect(rowWith(nameA)).toBeVisible();
    await expect(rowWith(nameB)).toBeVisible();
    await expect(rowWith(nameC)).toBeVisible();

    // A combined filter that matches nothing shows the empty message. The
    // name popover only renders unique names from the data — there is no
    // sentinel "không tồn tại" option — so we layer two real filters whose
    // AND result is empty: nameA is Miền Bắc, nameB is Miền Nam, so picking
    // nameA + region "Miền Nam" returns 0 rows.
    await openPopover(page, "partner-filter-name");
    await checkOption(page, "partner-filter-name", nameA);
    await closePopover(page);
    await openPopover(page, "partner-filter-region");
    await checkOption(page, "partner-filter-region", "Miền Nam");
    await closePopover(page);
    await expect(page.getByTestId("partners-filter-empty")).toBeVisible();
    await expect(page.getByTestId("partners-filter-empty")).toContainText(
      "Không có đối tác nào khớp bộ lọc",
    );
  });
});
