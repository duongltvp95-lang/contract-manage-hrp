import { expect, test } from "@playwright/test";

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
  seedPartner,
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
 * referenced by contracts and, until round 19, the rule was that no delete path
 * exists at all. Round 19 re-opens the path for the delete-admin emails only, so
 * the presence/absence of the delete button is now asserted in
 * `admin-privileged.spec.ts` (privileged admin sees it; a regular user does not).
 */

const stamp = runId();
const partnerName = `${TEST_PREFIX}Đối tác luồng ${stamp}`;
const renamedName = `${TEST_PREFIX}Đối tác đã đổi tên ${stamp}`;
const contractNumber = `${TEST_PREFIX}PARTNER-${stamp}`;

let partnerId = "";
let contractId = "";

test.describe.configure({ mode: "serial" });

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
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    // The list refreshed and shows the new partner with a zero contract count.
    const row = page.getByTestId("partner-row").filter({ hasText: partnerName });
    await expect(row).toBeVisible();
    await expect(row).toContainText("0");

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
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
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

/**
 * Feature round 2, part 3 — partner address + tax code, end to end.
 *
 * The two fields are OPTIONAL by Owner decision (T6). The flow proves three
 * things at the level a real user can see:
 *
 *   1. Both fields can be left blank (existing partners keep working);
 *   2. Both fields appear on the detail page when populated;
 *   3. The tax-code shape (10 digits, optional -NNN branch suffix) is enforced
 *      and a duplicate inside the same organization is rejected with a
 *      readable Vietnamese message.
 *
 * A second partner is created with the SAME tax code and the duplicate-check
 * path is exercised, then deleted by service role in `afterAll`.
 */
test.describe("partner address + tax code", () => {
  const partnerWithDetails = `${TEST_PREFIX}Đối tác có MST ${stamp}`;
  const partnerWithBranch = `${TEST_PREFIX}Đối tác chi nhánh ${stamp}`;
  const partnerNoDetails = `${TEST_PREFIX}Đối tác trống ${stamp}`;

  const taxCode = `0123456789`;
  const branchTaxCode = `0123456789-001`;

  let detailsPartnerId = "";
  let branchPartnerId = "";
  let noDetailsPartnerId = "";

  test.beforeAll(async () => {
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    const admin = adminClient();
    await sweep(admin);

    // Service-role cleanup for the partners this describe created. They were
    // created without any contracts, so the RESTRICT on delete is not
    // exercised; service_role is permitted regardless.
    for (const id of [detailsPartnerId, branchPartnerId, noDetailsPartnerId]) {
      if (!id) continue;
      await admin.from("partners").delete().eq("id", id);
    }
  });

  test("creates a partner with address and a main tax code", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerName", partnerWithDetails);
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await page.fill(
      "#partnerAddress",
      "Số 9, đường Bắc Hà, phường Thanh Xuân Bắc, Hà Nội",
    );
    await page.fill("#partnerTaxCode", taxCode);
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    // The new row in the list carries the tax code in the dedicated column.
    const row = page
      .getByTestId("partner-row")
      .filter({ hasText: partnerWithDetails });
    await expect(row).toBeVisible();
    await expect(row).toContainText(taxCode);

    // The database has all three fields stored.
    const { data } = await adminClient()
      .from("partners")
      .select("id, address, tax_code")
      .eq("name", partnerWithDetails)
      .single();

    expect(data?.address).toBe(
      "Số 9, đường Bắc Hà, phường Thanh Xuân Bắc, Hà Nội",
    );
    expect(data?.tax_code).toBe(taxCode);
    detailsPartnerId = data?.id ?? "";
  });

  test("accepts a tax code with the -NNN branch suffix", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerName", partnerWithBranch);
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await page.fill("#partnerTaxCode", branchTaxCode);
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    const row = page
      .getByTestId("partner-row")
      .filter({ hasText: partnerWithBranch });
    await expect(row).toContainText(branchTaxCode);

    const { data } = await adminClient()
      .from("partners")
      .select("id, tax_code")
      .eq("name", partnerWithBranch)
      .single();

    expect(data?.tax_code).toBe(branchTaxCode);
    branchPartnerId = data?.id ?? "";
  });

  test("rejects an invalid tax code and shows a Vietnamese message", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerName", `${TEST_PREFIX}Bỏ qua ${stamp}`);
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await page.fill("#partnerTaxCode", "not-a-tax-code");
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    // The form rejected the input: the sheet is still open and the field's
    // Vietnamese message is on screen.
    await expect(
      page.locator('[data-testid="partner-name-sheet"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toContainText(
      "Mã số thuế phải gồm 10 chữ số",
    );

    // Nothing was written.
    const { data } = await adminClient()
      .from("partners")
      .select("id")
      .eq("name", `${TEST_PREFIX}Bỏ qua ${stamp}`)
      .maybeSingle();

    expect(data).toBeNull();

    // Close the sheet so the next test starts clean.
    await clickSafe(page, '[data-testid="partner-name-sheet"] button:has-text("Huỷ")');
  });

  test("rejects a tax code that is already in use inside the same organization", async ({
    page,
  }) => {
    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerName", `${TEST_PREFIX}Trùng MST ${stamp}`);
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await page.fill("#partnerTaxCode", taxCode); // Same as partnerWithDetails.
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    // The duplicate check fires before the row is written, so the sheet stays
    // open and the readable Vietnamese message is on screen.
    await expect(
      page.locator('[data-testid="partner-name-sheet"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toContainText(
      "Mã số thuế đã được dùng cho đối tác khác trong tổ chức",
    );

    const { data } = await adminClient()
      .from("partners")
      .select("id")
      .eq("name", `${TEST_PREFIX}Trùng MST ${stamp}`)
      .maybeSingle();

    expect(data).toBeNull();

    await clickSafe(page, '[data-testid="partner-name-sheet"] button:has-text("Huỷ")');
  });

  test("accepts a duplicate tax code under a different company (round 29)", async ({
    page,
  }) => {
    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    const name = `${TEST_PREFIX}Trùng MST khác công ty ${stamp}`;
    await page.fill("#partnerName", name);
    // HR VN — a COMPLETELY different company from partnerWithDetails (HRP).
    await clickSafe(page, '[data-testid="company-checkbox-HR VN"]');
    await page.fill("#partnerTaxCode", taxCode); // Same code as partnerWithDetails.
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    // Allowed — the sheet closes and the new partner shows in the list.
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("partner-row").filter({ hasText: name }),
    ).toBeVisible({ timeout: 30_000 });

    // Two partners now share the code (one per company).
    const { data } = await adminClient()
      .from("partners")
      .select("id")
      .eq("tax_code", taxCode);
    expect(data ?? []).toHaveLength(2);

    // Remove the extra partner so the serial suite stays deterministic.
    const { data: created } = await adminClient()
      .from("partners")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    if (created) {
      await adminClient().from("partners").delete().eq("id", created.id);
    }
  });

  test("creates a partner with both fields left blank (backwards-compatible)", async ({
    page,
  }) => {
    await login(page);
    await gotoAndSettle(page, "/partners");

    await clickSafe(page, '[data-testid="partner-add-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerName", partnerNoDetails);
    // Address + tax code are left empty on purpose.
    await clickSafe(page, '[data-testid="company-checkbox-HRP"]');
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    const row = page
      .getByTestId("partner-row")
      .filter({ hasText: partnerNoDetails });
    await expect(row).toBeVisible();
    // The tax-code column falls back to the em-dash when null.
    await expect(row).toContainText("—");

    const { data } = await adminClient()
      .from("partners")
      .select("id, address, tax_code")
      .eq("name", partnerNoDetails)
      .single();

    expect(data?.address).toBeNull();
    expect(data?.tax_code).toBeNull();
    noDetailsPartnerId = data?.id ?? "";
  });

  test("the detail page shows address and tax code when populated", async ({ page }) => {
    await login(page);
    await gotoAndSettle(page, `/partners/${detailsPartnerId}`);

    await expect(page.getByTestId("partner-detail-name")).toHaveText(
      partnerWithDetails,
    );
    await expect(page.getByTestId("partner-detail-tax-code")).toHaveText(taxCode);
    await expect(page.getByTestId("partner-detail-address")).toContainText(
      "Thanh Xuân Bắc",
    );
  });

  test("the detail page hides the meta block when both fields are blank", async ({
    page,
  }) => {
    await login(page);
    await gotoAndSettle(page, `/partners/${noDetailsPartnerId}`);

    await expect(page.getByTestId("partner-detail-name")).toHaveText(
      partnerNoDetails,
    );
    // The whole meta block (MST + địa chỉ) is omitted when both are null.
    await expect(page.getByTestId("partner-detail-meta")).toHaveCount(0);
  });

  test("edits the address and tax code from the detail page", async ({ page }) => {
    const updatedAddress = "Tầng 5, tòa nhà X, phường Bến Nghé, TP.HCM";
    const updatedTaxCode = "9876543210";

    await login(page);
    await gotoAndSettle(page, `/partners/${detailsPartnerId}`);

    await clickSafe(page, '[data-testid="partner-rename-button"]');
    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeVisible();

    await page.fill("#partnerAddress", updatedAddress);
    await page.fill("#partnerTaxCode", updatedTaxCode);
    await clickSafe(page, '[data-testid="partner-name-submit"]');

    await expect(page.locator('[data-testid="partner-name-sheet"]')).toBeHidden({
      timeout: 30_000,
    });

    await expect(page.getByTestId("partner-detail-tax-code")).toHaveText(
      updatedTaxCode,
    );
    await expect(page.getByTestId("partner-detail-address")).toContainText(
      "Bến Nghé",
    );

    const { data } = await adminClient()
      .from("partners")
      .select("address, tax_code")
      .eq("id", detailsPartnerId)
      .single();

    expect(data?.address).toBe(updatedAddress);
    expect(data?.tax_code).toBe(updatedTaxCode);
  });

  test("responsive columns show the correct subset at each breakpoint (round 31)", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Round 31 — a partner in the list is enough; we only assert which
    // header / cell testids are visible at each viewport. We do not need to
    // seed region/abbreviation because we only count visible *headers*.
    const admin = adminClient();
    await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Responsive ${stamp}`,
      taxCode: "0311223344",
    });

    await login(page);
    await gotoAndSettle(page, "/partners");

    // All viewport checks share one helper: count the visible header testids
    // and assert that the three "always visible" headers are present.
    const checkViewport = async (width: number, expectedVisible: number) => {
      await page.setViewportSize({ width, height: 800 });
      // Force a layout re-evaluation.
      await page.waitForTimeout(150);

      // The "always visible" headers (Tên / Trạng thái / Thao tác).
      await expect(page.getByTestId("partner-head-status")).toBeVisible();
      await expect(page.getByTestId("partner-head-actions")).toBeVisible();
      // Tên cell uses a per-row testid; use the row testid as proxy — the
      // first row's name link is always rendered.
      await expect(page.getByTestId("partner-row").first()).toBeVisible();

      // The set of optional headers and their visibility.
      const optional = [
        "partner-head-abbr",
        "partner-head-tax-code",
        "partner-head-region",
        "partner-head-company",
        "partner-head-contract-count",
      ];
      const visibleCount = (
        await Promise.all(
          optional.map((id) => page.getByTestId(id).isVisible()),
        )
      ).filter(Boolean).length;
      expect(visibleCount).toBe(expectedVisible);
    };

    // < sm  : 3 always-visible only (no optional).
    await checkViewport(375, 0);
    // sm    : + abbr + tax-code (2).
    await checkViewport(640, 2);
    // md    : + region (3).
    await checkViewport(768, 3);
    // lg    : + company (4).
    await checkViewport(1024, 4);
    // xl    : + contract-count (5) — the table is now at full width.
    await checkViewport(1280, 5);
  });
});
