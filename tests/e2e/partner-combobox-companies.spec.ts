import { expect, test } from "@playwright/test";

import {
  ORG_A,
  HRP_COMPANY_ID,
  HR_VN_COMPANY_ID,
  TEST_PREFIX,
  adminClient,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  runId,
  seedPartner,
  seedPartnerCompanyLink,
  sweep,
} from "./helpers";

/**
 * Round 33+ — trường "Công ty" trong form hợp đồng phụ thuộc vào đối tác
 * đang chọn.
 *
 * Lịch sử:
 *   - round 32: badge công ty nằm BÊN TRONG ô "Đối tác" (chờ server, thấy
 *     "lag"). File này gốc viết cho round 32.
 *   - round 33: bỏ badge, thêm Select "Công ty" nằm NGAY DƯỚI ô "Đối tác",
 *     danh sách công ty = toàn bộ công ty của tổ chức (HRP, HR VN).
 *   - round 33+: Owner đảo lại — danh sách công ty lọc theo đối tác. File
 *     này được VIẾT LẠI cho hành vi mới.
 */
test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

const stamp = runId();

test.afterAll(async () => {
  // Sweep dọn toàn bộ contract + partner có prefix E2ETEST- (contract đi trước
  // vì partner bị ON DELETE RESTRICT khi còn contract tham chiếu).
  await sweep(adminClient());
});

test("form hợp đồng lọc công ty theo đối tác đang chọn (round 33+)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const admin = adminClient();

  // Hai đối tác:
  //   - partnerWithHrp: liên kết với HRP
  //   - partnerWithHrVn: liên kết với HR VN
  // Giúp khẳng định Select chỉ hiện công ty thuộc đối tác đang chọn.
  const partnerWithHrp = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Hrp only ${stamp}`,
    taxCode: `10${stamp.slice(-6).padStart(6, "0")}`,
  });
  await seedPartnerCompanyLink(admin, partnerWithHrp.id, HRP_COMPANY_ID);

  const partnerWithHrVn = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}HrVn only ${stamp}`,
    taxCode: `11${stamp.slice(-6).padStart(6, "0")}`,
  });
  await seedPartnerCompanyLink(admin, partnerWithHrVn.id, HR_VN_COMPANY_ID);

  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  // 1. Chọn đối tác "Hrp only" qua combobox.
  await clickSafe(page, '[data-testid="partner-combobox"]');
  await page.getByTestId("partner-combobox-search").waitFor({ state: "visible" });

  const search = page.getByTestId("partner-combobox-search");
  await search.click();
  await search.pressSequentially(partnerWithHrp.name, { delay: 30 });

  const option = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(partnerWithHrp.name, { exact: true }) });
  await option.waitFor({ state: "visible", timeout: 30_000 });
  await option.click();

  await expect(page.getByTestId("partner-combobox")).toContainText(partnerWithHrp.name);

  // 2. Trường "Công ty" nằm dưới ô "Đối tác" và không còn badge trong combobox.
  await expect(
    page
      .getByTestId("partner-combobox")
      .getByTestId("partner-company-badge"),
  ).toHaveCount(0);

  const partnerField = page.getByTestId("partner-combobox");
  const companySelect = page.getByTestId("contract-company-select");
  await expect(companySelect).toBeVisible({ timeout: 30_000 });

  const [partnerBox, companyBox] = await Promise.all([
    partnerField.boundingBox(),
    companySelect.boundingBox(),
  ]);
  expect(companyBox).not.toBeNull();
  expect(partnerBox).not.toBeNull();
  expect(companyBox!.y).toBeGreaterThan(partnerBox!.y);

  // 3. Select "Công ty" chỉ chứa HRP — không chứa HR VN (vì đối tác chỉ liên
  //    kết HRP).
  await companySelect.click();
  const visibleOptions = await page.getByRole("option").allInnerTexts();
  expect(visibleOptions).toContain("HRP");
  expect(visibleOptions).not.toContain("HR VN");
  // Chọn HRP để form hợp lệ và lưu được.
  await page.getByRole("option", { name: "HRP", exact: true }).click();
  await expect(companySelect).toContainText("HRP");

  // 4. Lưu hợp đồng và xác minh `company_id` được ghi xuống DB.
  const contractNumber = `${TEST_PREFIX}C${stamp}`;
  await page.fill('input[name="contractNumber"]', contractNumber);

  await page.getByTestId("contract-form-submit").click();
  await page.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 120_000 });
  const contractId = page.url().split("/").pop() as string;

  const { data: saved, error: savedError } = await admin
    .from("contracts")
    .select("company_id, partner_id")
    .eq("id", contractId)
    .single();

  if (savedError) {
    throw new Error(`could not read back the saved contract: ${savedError.message}`);
  }

  expect(saved?.company_id).toBe(HRP_COMPANY_ID);
  expect(saved?.partner_id).toBe(partnerWithHrp.id);

  // 5. Đổi sang đối tác "HrVn only" → Select phải lọc lại, chỉ hiện HR VN.
  await gotoAndSettle(page, "/contracts/new");

  await clickSafe(page, '[data-testid="partner-combobox"]');
  await page.getByTestId("partner-combobox-search").waitFor({ state: "visible" });
  const search2 = page.getByTestId("partner-combobox-search");
  await search2.click();
  await search2.pressSequentially(partnerWithHrVn.name, { delay: 30 });

  const option2 = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(partnerWithHrVn.name, { exact: true }) });
  await option2.waitFor({ state: "visible", timeout: 30_000 });
  await option2.click();

  await expect(page.getByTestId("partner-combobox")).toContainText(partnerWithHrVn.name);

  const companySelect2 = page.getByTestId("contract-company-select");
  await expect(companySelect2).toBeVisible({ timeout: 30_000 });
  await companySelect2.click();
  const visibleOptions2 = await page.getByRole("option").allInnerTexts();
  expect(visibleOptions2).toContain("HR VN");
  expect(visibleOptions2).not.toContain("HRP");
  await page.getByRole("option", { name: "HR VN", exact: true }).click();
  await expect(companySelect2).toContainText("HR VN");
});

test("đối tác chưa gán công ty → Select Công ty bị disable + gợi ý (round 33+)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const admin = adminClient();

  // Seed một đối tác CHƯA liên kết công ty nào.
  const partnerNoCompany = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}No company ${stamp}`,
    taxCode: `12${stamp.slice(-6).padStart(6, "0")}`,
  });

  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  // Chọn đối tác "No company".
  await clickSafe(page, '[data-testid="partner-combobox"]');
  await page.getByTestId("partner-combobox-search").waitFor({ state: "visible" });

  const search = page.getByTestId("partner-combobox-search");
  await search.click();
  await search.pressSequentially(partnerNoCompany.name, { delay: 30 });

  const option = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(partnerNoCompany.name, { exact: true }) });
  await option.waitFor({ state: "visible", timeout: 30_000 });
  await option.click();

  await expect(page.getByTestId("partner-combobox")).toContainText(partnerNoCompany.name);

  // Select "Công ty" bị disable và hiện gợi ý tiếng Việt.
  const companySelect = page.getByTestId("contract-company-select");
  await expect(companySelect).toBeVisible({ timeout: 30_000 });
  await expect(companySelect).toBeDisabled();
  await expect(page.getByTestId("contract-companies-hint")).toContainText(
    "Đối tác này chưa được gán công ty",
  );

  // Submit bị chặn vì thiếu công ty (đây là hành vi MONG ĐỢI khi tạo mới).
  await page.fill('input[name="contractNumber"]', `${TEST_PREFIX}N${stamp}`);
  await page.getByTestId("contract-form-submit").click();
  // Không chuyển trang chi tiết.
  await expect(page).toHaveURL(/\/contracts\/new/, { timeout: 5_000 });
  // Form vẫn ở trạng thái nhập, người dùng thấy validate "Vui lòng chọn công ty".
  await expect(page.getByText("Vui lòng chọn công ty")).toBeVisible();
});