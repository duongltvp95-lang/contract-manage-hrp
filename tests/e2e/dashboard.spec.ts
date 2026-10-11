import { expect, test } from "@playwright/test";
import { addDays, format } from "date-fns";

import {
  ORG_A,
  TEST_PREFIX,
  adminClient,
  gotoAndSettle,
  hasLiveBackend,
  login,
  runId,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 15, part 1 — the dashboard shows the linked partner name + company
 * badges (and no "—" in the partner / company cells).
 */

// The organization A seed companies (see the round 10 migration).
const ORG_A_HRP = "00000000-0000-4000-8000-000000000001";
const ORG_A_HR_VN = "00000000-0000-4000-8000-000000000002";

test.describe("dashboard partner + company (round 15)", () => {
  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    await sweep(adminClient());
  });

  test("shows the partner name and company badges, no em-dash", async ({ page }) => {
    test.setTimeout(120_000);

    const stamp = runId();
    const partnerName = `${TEST_PREFIX}Đối tác ${stamp}`;
    const contractNumber = `${TEST_PREFIX}HD ${stamp}`;
    const admin = adminClient();

    // Seed a partner linked to both companies, plus one contract pointing at it.
    const { data: partner } = await admin
      .from("partners")
      .insert({ organization_id: ORG_A, name: partnerName })
      .select("id")
      .single();
    const partnerId = partner?.id as string;
    expect(partnerId).toBeTruthy();

    await admin.from("partner_companies").insert([
      { partner_id: partnerId, company_id: ORG_A_HRP },
      { partner_id: partnerId, company_id: ORG_A_HR_VN },
    ]);

    await admin.from("contracts").insert({
      organization_id: ORG_A,
      contract_number: contractNumber,
      partner_id: partnerId,
      // Round 37 — the company on a contract is `contracts.company_id`. Pin
      // this contract to HR VN so the dashboard shows one predictable badge.
      company_id: ORG_A_HR_VN,
      expiry_date: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    });

    await login(page);
    await gotoAndSettle(page, "/dashboard");

    const row = page
      .getByTestId("recent-contracts-table")
      .getByRole("row")
      .filter({ hasText: contractNumber });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Partner cell (2nd td) shows the resolved name, never "—".
    await expect(row).toContainText(partnerName);
    await expect(row.locator("td").nth(1)).not.toContainText("—");

    // Company cell (3rd td) shows the single company the contract is signed
    // for (round 37). The partner links to HRP and HR VN, but the contract
    // was created with companyId=HR VN, so only HR VN is shown.
    await expect(row.getByTestId("partner-company-badge")).toHaveCount(1);
    await expect(
      row.getByTestId("partner-company-badge").filter({ hasText: /^HR VN$/ }),
    ).toBeVisible();
    await expect(row.locator("td").nth(2)).not.toContainText("—");
  });
});
