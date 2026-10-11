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
  selectCompany,
  sweep,
} from "./helpers";

/**
 * Round 33 — trường "Công ty" trong form hợp đồng.
 *
 * Lịch sử: bản đầu của file này là round 32, khẳng định badge công ty hiện
 * BÊN TRONG ô "Đối tác". Badge đó phải chờ `partnerCompaniesAction()` (server
 * action) mới hiện → người dùng thấy độ trễ rõ rệt sau khi bấm chọn đối tác.
 * Round 33 xoá badge và thay bằng một trường "Công ty" riêng đặt NGAY DƯỚI ô
 * "Đối tác".
 *
 * Vì vậy file này được VIẾT LẠI cho hành vi mới — không xoá để né lỗi: các
 * assertion round 32 được đảo thành phủ định (badge phải VẮNG), và thêm kiểm
 * tra mới (Select "Công ty" nằm dưới ô "Đối tác", chọn HRP, và `company_id`
 * thực sự được ghi xuống DB).
 *
 * Vẫn để trong file riêng — không nhúng vào `partners.spec.ts` vì file đó đang
 * ở mode `serial`, một test fail sẽ skip toàn bộ test sau.
 */
test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

// HRP company UUID — định danh cố định trong seed data.
const HRP_COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const stamp = runId();

test.afterAll(async () => {
  // Sweep dọn toàn bộ contract + partner có prefix E2ETEST- (contract đi trước
  // vì partner bị ON DELETE RESTRICT khi còn contract tham chiếu).
  await sweep(adminClient());
});

test("form hợp đồng có trường Công ty ngay dưới ô Đối tác và lưu được (round 33)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Seed một partner để chọn trong form.
  const admin = adminClient();
  const seeded = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Company field ${stamp}`,
    taxCode: `09${stamp.slice(-6).padStart(6, "0")}`,
  });

  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  // 1. Chọn đối tác qua combobox.
  await clickSafe(page, '[data-testid="partner-combobox"]');
  await page.getByTestId("partner-combobox-search").waitFor({ state: "visible" });

  const search = page.getByTestId("partner-combobox-search");
  await search.click();
  await search.pressSequentially(seeded.name, { delay: 30 });

  const option = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(seeded.name, { exact: true }) });
  await option.waitFor({ state: "visible", timeout: 30_000 });
  await option.click();

  await expect(page.getByTestId("partner-combobox")).toContainText(seeded.name);

  // 2. Round 32 đã bị xoá: ô "Đối tác" KHÔNG còn badge công ty bên trong.
  //    Đây là hành vi Owner yêu cầu, nên test phải khẳng định nó vắng mặt.
  await expect(
    page
      .getByTestId("partner-combobox")
      .getByTestId("partner-company-badge"),
  ).toHaveCount(0);

  // 3. Trường "Công ty" tồn tại, nằm ngay dưới ô "Đối tác".
  const partnerField = page.getByTestId("partner-combobox");
  const companySelect = page.getByTestId("contract-company-select");
  await expect(companySelect).toBeVisible({ timeout: 30_000 });

  const [partnerBox, companyBox] = await Promise.all([
    partnerField.boundingBox(),
    companySelect.boundingBox(),
  ]);
  expect(companyBox).not.toBeNull();
  expect(partnerBox).not.toBeNull();
  // companySelect nằm DƯỚI partnerField (toạ độ y lớn hơn).
  expect(companyBox!.y).toBeGreaterThan(partnerBox!.y);

  // 4. Chọn HRP trong Select (dùng chung helper với các test create khác).
  await selectCompany(page, "HRP");
  await expect(companySelect).toContainText("HRP");

  // 5. Lưu hợp đồng và xác minh company_id thực sự được ghi xuống DB.
  const contractNumber = `${TEST_PREFIX}C${stamp}`;
  await page.fill('input[name="contractNumber"]', contractNumber);

  await page.getByTestId("contract-form-submit").click();

  // Chuyển tới trang chi tiết hợp đồng vừa tạo.
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
  expect(saved?.partner_id).toBe(seeded.id);
});