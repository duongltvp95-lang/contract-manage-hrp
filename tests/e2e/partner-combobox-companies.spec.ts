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

/**
 * Round 32 — combobox đối tác hiện công ty liên kết.
 *
 * Đặt trong file riêng để chạy độc lập với `partners.spec.ts`, vì file đó
 * đang ở mode `serial` — một test fail làm skip toàn bộ test sau, kể cả
 * test R32. Tách ra đảm bảo gate R32 chạy được bất kể tình trạng của
 * các test khác.
 */
test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

// HRP company UUID — định danh cố định trong seed data.
const HRP_COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const stamp = runId();

test.afterAll(async () => {
  // Sweep dọn toàn bộ partner có prefix E2ETEST-, bao gồm cả partner
  // R32 vừa tạo (ON DELETE CASCADE trên partner_companies sẽ tự dọn).
  await sweep(adminClient());
});

test("combobox shows the linked-company badge on the trigger after selecting (round 32)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Seed một partner mới gắn với HRP qua partner_companies.
  const admin = adminClient();
  const seeded = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Combobox badge ${stamp}`,
    taxCode: "0322334455",
  });
  const { error: junctionError } = await admin
    .from("partner_companies")
    .insert({ partner_id: seeded.id, company_id: HRP_COMPANY_ID });
  if (junctionError) {
    throw new Error(`could not link HRP to the test partner: ${junctionError.message}`);
  }

  // Mở form tạo hợp đồng, mở combobox, tìm partner vừa seed qua search.
  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  await clickSafe(page, '[data-testid="partner-combobox"]');
  // Chờ input search sẵn sàng (popover mở + focus vào input).
  await page.getByTestId("partner-combobox-search").waitFor({ state: "visible" });
  // Dùng pressSequentially thay vì fill: fill đôi khi không kích hoạt
  // React onChange khi popover vừa mount (event bị swallow bởi Radix
  // focus-trap trong quá trình animation). pressSequentially bắn từng
  // phím nên chắc chắn trigger handleTermChange.
  const search = page.getByTestId("partner-combobox-search");
  await search.click();
  await search.pressSequentially(seeded.name, { delay: 30 });

  const option = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(seeded.name, { exact: true }) });
  await option.waitFor({ state: "visible", timeout: 30_000 });
  // Tùy chọn cũng phải có badge HRP ngay khi hiển thị — đó là yêu cầu
  // chính của R32, ngoài trigger.
  await expect(
    option.getByTestId("partner-company-badge").first(),
  ).toHaveText("HRP", { timeout: 30_000 });
  await option.click();

  // Nút trigger (data-testid="partner-combobox") phải hiện badge HRP
  // ngay bên cạnh tên partner — combobox fetch công ty cho id vừa chọn
  // qua partnerCompaniesAction và render CompanyBadges.
  await expect(page.getByTestId("partner-combobox")).toContainText(seeded.name);
  await expect(
    page
      .getByTestId("partner-combobox")
      .getByTestId("partner-company-badge")
      .first(),
  ).toHaveText("HRP", { timeout: 30_000 });
});
