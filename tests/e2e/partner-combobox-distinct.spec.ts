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
 * Round 34 — combobox "Đối tác" phải hiện ĐÚNG 1 DÒNG cho mỗi đối tác, bất kể
 * đối tác đó liên kết 1 hay nhiều công ty.
 *
 * Bối cảnh (Owner báo 2026-10-11): tìm một đối tác đã liên kết cả HRP + HR VN
 * thì thấy NHIỀU dòng cùng tên. Điều tra trên dữ liệu thật cho thấy nguyên nhân
 * KHÔNG phải liên kết công ty sinh dòng trùng, mà là trong DB tồn tại hai bản
 * ghi `partners` khác `id` nhưng trùng `name` + `tax_code` (mỗi bản ghi gắn với
 * một công ty khác nhau — đúng quy tắc "mỗi công ty một đối tác" đã chốt ở
 * round 10). File này khóa lại phần HÀNH VI ĐÚNG: một đối tác (một `id`) dù liên
 * kết bao nhiêu công ty vẫn chỉ chiếm MỘT dòng, và Select "Công ty" bên dưới
 * hiện đúng các công ty mà đối tác đó liên kết.
 *
 * Tách riêng `partner-combobox-companies.spec.ts` (round 33+) để mỗi round đọc
 * độc lập.
 */
test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

const stamp = runId();

test.afterAll(async () => {
  // Xoá contract trước (partner bị ON DELETE RESTRICT khi còn contract tham chiếu).
  await sweep(adminClient());
});

test("đối tác liên kết 2 công ty → combobox chỉ 1 dòng, Select Công ty hiện đủ 2 công ty (round 34)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const admin = adminClient();

  // Một đối tác duy nhất, liên kết CẢ HAO công ty.
  const partner = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Both ${stamp}`,
    taxCode: `13${stamp.slice(-6).padStart(6, "0")}`,
  });
  await seedPartnerCompanyLink(admin, partner.id, HRP_COMPANY_ID);
  await seedPartnerCompanyLink(admin, partner.id, HR_VN_COMPANY_ID);

  // Chặt chẽ hơn kiểm tra UI: xác nhận ở tầng DB đúng 1 partner + 2 liên kết.
  const { data: partnerRows } = await admin
    .from("partners")
    .select("id")
    .eq("id", partner.id);
  expect(partnerRows).toHaveLength(1);

  const { data: links } = await admin
    .from("partner_companies")
    .select("company_id")
    .eq("partner_id", partner.id);
  expect(links).toHaveLength(2);

  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  // 1. Mở combobox, gõ tên → dropdown CHỈ có đúng 1 dòng khớp tên đó.
  await clickSafe(page, '[data-testid="partner-combobox"]');
  await page.getByTestId("partner-combobox-search").waitFor({ state: "visible" });

  const search = page.getByTestId("partner-combobox-search");
  await search.click();
  await search.pressSequentially(partner.name, { delay: 30 });

  const matched = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(partner.name, { exact: true }) });
  await expect(matched).toHaveCount(1, { timeout: 30_000 });

  // Mọi dòng trong dropdown phải trỏ về một `data-partner-id` khác nhau — bất
  // biến "mỗi đối tác đúng 1 dòng", không phụ thuộc dòng đã chọn được ghim ở đầu.
  const ids = await page
    .getByTestId("partner-option")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-partner-id")));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.filter((id) => id === partner.id)).toHaveLength(1);

  await matched.click();
  await expect(page.getByTestId("partner-combobox")).toContainText(partner.name);

  // 2. Select "Công ty" hiện ĐỦ cả HRP và HR VN.
  const companySelect = page.getByTestId("contract-company-select");
  await expect(companySelect).toBeVisible({ timeout: 30_000 });
  await expect(companySelect).not.toBeDisabled();
  await expect(companySelect).toContainText("Chọn công ty");

  await companySelect.click();
  const options = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim());

  expect(options).toContain("HRP");
  expect(options).toContain("HR VN");
  // Danh sách chỉ gồm các công ty của đối tác — không công ty nào khác.
  expect(options.filter((t) => t !== "").sort()).toEqual(["HR VN", "HRP"]);
});

test("đổi đối tác → Select Công ty lọc lại theo đối tác mới (round 34)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const admin = adminClient();

  // Đối tác chỉ liên kết HR VN — dùng làm "đối tác mới" để đối chiếu.
  const hrVnOnly = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}HrVnOnly ${stamp}`,
    taxCode: `14${stamp.slice(-6).padStart(6, "0")}`,
  });
  await seedPartnerCompanyLink(admin, hrVnOnly.id, HR_VN_COMPANY_ID);

  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  // Chọn đối tác 2 công ty.
  await clickSafe(page, '[data-testid="partner-combobox"]');
  await page.getByTestId("partner-combobox-search").waitFor({ state: "visible" });
  const search = page.getByTestId("partner-combobox-search");
  await search.click();
  await search.pressSequentially(`${TEST_PREFIX}Both ${stamp}`, { delay: 30 });

  const bothOption = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(`${TEST_PREFIX}Both ${stamp}`, { exact: true }) });
  await bothOption.waitFor({ state: "visible", timeout: 30_000 });
  await bothOption.click();

  const companySelect = page.getByTestId("contract-company-select");
  await expect(companySelect).toBeVisible({ timeout: 30_000 });
  await companySelect.click();
  expect((await page.getByRole("option").allInnerTexts()).map((t) => t.trim()).sort()).toEqual([
    "HR VN",
    "HRP",
  ]);
  // Đóng lại Select, chuyển sang đối tác chỉ có HR VN.
  await page.keyboard.press("Escape");

  await clickSafe(page, '[data-testid="partner-combobox"]');
  const search2 = page.getByTestId("partner-combobox-search");
  await search2.waitFor({ state: "visible" });
  await search2.click();
  await search2.pressSequentially(hrVnOnly.name, { delay: 30 });

  const hrVnOption = page
    .getByTestId("partner-option")
    .filter({ has: page.getByText(hrVnOnly.name, { exact: true }) });
  await hrVnOption.waitFor({ state: "visible", timeout: 30_000 });

  // Combobox CỐ Ý ghim đối tác đang chọn ở đầu danh sách (xem `options` trong
  // `partner-combobox.tsx`) nên tổng số dòng có thể > 1. Bất biến cần khóa là
  // "mỗi đối tác đúng 1 dòng": đối tác vừa tìm phải khớp đúng 1 dòng, và không
  // có `data-partner-id` nào lặp lại.
  await expect(hrVnOption).toHaveCount(1);
  const ids2 = await page
    .getByTestId("partner-option")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-partner-id")));
  expect(new Set(ids2).size).toBe(ids2.length);
  expect(ids2).toContain(hrVnOnly.id);

  await hrVnOption.click();

  await expect(page.getByTestId("partner-combobox")).toContainText(hrVnOnly.name);

  // Select phải lọc còn đúng HR VN.
  const companySelect2 = page.getByTestId("contract-company-select");
  await expect(companySelect2).toBeVisible({ timeout: 30_000 });
  await companySelect2.click();
  const options2 = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim());
  expect(options2).toContain("HR VN");
  expect(options2).not.toContain("HRP");
});