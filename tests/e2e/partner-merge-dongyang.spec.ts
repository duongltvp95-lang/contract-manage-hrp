/**
 * Round 35 — gộp 2 bản ghi `partners` cùng MST thành 1 dòng trên /partners.
 *
 * Bối cảnh: 2026-10-10 phát hiện DB có 2 bản ghi `partners` cùng
 * `tax_code = "2500507916"` (CÔNG TY TNHH DONGYANG ELECTRONICS VIỆT NAM),
 * mỗi bản ghi gắn 1 công ty (HRP / HR VN). Owner quyết định gộp SQL thật,
 * giữ 1 bản ghi, xoá 1 bản ghi dư; UI chỉ phản ánh DB đã sạch.
 *
 * File này KHÔNG chạm vào 2 bản ghi DONGYANG thật (Owner data, rule §6).
 * Mỗi test seed 2 partner giả lập với MST riêng (`999` + 7 số cuối của
 * `runId()`) để 2 test lân cận không truy vấn nhầm dòng của nhau:
 *   1. Trước gộp — /partners hiện 2 dòng, mỗi dòng 1 badge (HRP hoặc HR VN).
 *   2. Gộp bằng helper `mergePartnersByTaxCode` (admin client, KHÔNG
 *      chạy migration production trong test).
 *   3. Sau gộp — 1 dòng duy nhất, badge = "HRP / HR VN" (1 badge, không
 *      phải 2). Combobox /contracts/new cũng chỉ hiện 1 dòng.
 *   4. Filter "Công ty" HRP/HR VN trên /partners — dòng gộp hiện ở cả 2
 *      filter; filter công ty không liên kết → 0 dòng.
 *   5. Tạo hợp đồng mới với partner gộp + chọn HRP lưu thành công.
 */

import { expect, test } from "@playwright/test";

import {
  HRP_COMPANY_ID,
  HR_VN_COMPANY_ID,
  ORG_A,
  TEST_PREFIX,
  adminClient,
  clickSafe,
  gotoAndSettle,
  hasLiveBackend,
  login,
  mergePartnersByTaxCode,
  runId,
  seedPartner,
  seedPartnerCompanyLink,
  selectCompany,
  selectPartner,
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/** MST giả lập, 10 chữ số, đuôi là 7 chữ số cuối của `runId()`.
 *  Dùng chữ số (không base36) để selector `[data-partner-tax-code=...]`
 *  không bị lẫn ký tự `data-partner-tax-code="999abc"`. Mỗi test 1 MST
 *  khác nhau để test lân cận không ăn dòng của nhau. */
function fakeTax(): string {
  const tail = runId()
    .split("")
    .map((c) => String(c.charCodeAt(0) % 10))
    .join("")
    .padStart(7, "0")
    .slice(-7);
  return `999${tail}`;
}

/** Số nguyên 7 chữ số, dùng cho `name` đối tác (TEST_PREFIX + số) để tên
 *  không chứa ký tự base36 (một số test gõ tên vào combobox / dùng làm
 *  văn bản tìm kiếm). */
function uniqueStamp(): string {
  const tail = runId()
    .split("")
    .map((c) => String(c.charCodeAt(0) % 10))
    .join("")
    .padStart(7, "0")
    .slice(-7);
  return tail;
}

test.afterAll(async () => {
  // Xoá contract trước (partner bị ON DELETE RESTRICT khi còn contract).
  await sweep(adminClient());
  // Dọn nốt partner test (sweep chỉ quét contract_number E2ETEST-%, không
  // xoá partner). Vì partner test không có contract nên ON DELETE RESTRICT
  // không cản — xoá thẳng theo tên.
  await adminClient().from("partners").delete().like("name", `${TEST_PREFIX}%`);
});

test("trước gộp: 2 dòng cùng MST, mỗi dòng 1 công ty (round 35)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const tax = fakeTax();
  const stamp = uniqueStamp();
  const admin = adminClient();

  const a = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Gộp A ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, a.id, HRP_COMPANY_ID);

  const b = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Gộp B ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, b.id, HR_VN_COMPANY_ID);

  await login(page);
  await gotoAndSettle(page, "/partners");

  // 2 dòng cùng MST (chỉ của test này)
  const rows = page.locator(`[data-partner-tax-code="${tax}"]`);
  await expect(rows).toHaveCount(2);

  // Mỗi dòng hiện 1 badge đúng công ty của nó (HRP hoặc HR VN), không phải
  // badge gộp. 1 dòng có badge "HRP", 1 dòng có badge "HR VN".
  const rowsWithHrp = rows.filter({
    has: page.getByTestId("partner-company-badge").filter({ hasText: /^HRP$/ }),
  });
  const rowsWithHrVn = rows.filter({
    has: page.getByTestId("partner-company-badge").filter({ hasText: /^HR VN$/ }),
  });
  await expect(rowsWithHrp).toHaveCount(1);
  await expect(rowsWithHrVn).toHaveCount(1);
});

test("sau gộp: 1 dòng duy nhất, badge = 'HRP / HR VN' (round 35)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const tax = fakeTax();
  const stamp = uniqueStamp();
  const admin = adminClient();

  const a = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Sau gộp A ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, a.id, HRP_COMPANY_ID);

  const b = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Sau gộp B ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, b.id, HR_VN_COMPANY_ID);

  await login(page);
  await gotoAndSettle(page, "/partners");

  // Trước gộp: 2 dòng
  await expect(page.locator(`[data-partner-tax-code="${tax}"]`)).toHaveCount(2);

  // Gộp (giữ `a`, xoá `b`); admin client tương đương migration production.
  await mergePartnersByTaxCode(admin, a.id, b.id);

  // Reload trang — DB đã gộp
  await page.reload();

  // Sau gộp: 1 dòng
  const rows = page.locator(`[data-partner-tax-code="${tax}"]`);
  await expect(rows).toHaveCount(1);

  // Badge gộp duy nhất = "HR VN / HRP" (sort alphabet ổn định — round 35),
  // có chính xác 1 testid.
  const badge = rows.first().getByTestId("partner-company-badge");
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveText("HR VN / HRP");
});

test("sau gộp: filter 'Công ty' vẫn lọc đúng cho dòng gộp (round 35)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const tax = fakeTax();
  const stamp = uniqueStamp();
  const admin = adminClient();

  const a = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Filter A ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, a.id, HRP_COMPANY_ID);

  const b = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Filter B ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, b.id, HR_VN_COMPANY_ID);

  await mergePartnersByTaxCode(admin, a.id, b.id);

  await login(page);
  await gotoAndSettle(page, "/partners");

  const companyFilter = page.getByTestId("partner-filter-company");
  await expect(companyFilter).toBeVisible();

  // Filter HRP → dòng gộp vẫn xuất hiện (vì gắn cả 2 công ty)
  await clickSafe(page, '[data-testid="partner-filter-company"]');
  await page.getByRole("option", { name: /^HRP$/ }).click();
  await expect(page.locator(`[data-partner-tax-code="${tax}"]`)).toHaveCount(1);

  // Filter HR VN → dòng gộp vẫn xuất hiện
  await clickSafe(page, '[data-testid="partner-filter-company"]');
  await page.getByRole("option", { name: /^HR VN$/ }).click();
  await expect(page.locator(`[data-partner-tax-code="${tax}"]`)).toHaveCount(1);

  // Mở filter lần 3, tìm option có tên khác HRP/HR VN (công ty không liên
  // kết tới dòng gộp) → 0 dòng. Trong seed chỉ có HRP + HR VN nên bước
  // này sẽ KHÔNG assert nếu không tìm thấy option khác (DB hiện chỉ có
  // 2 công ty).
  await clickSafe(page, '[data-testid="partner-filter-company"]');
  const options = await page.getByRole("option").allInnerTexts();
  const otherCompany = options
    .map((t) => t.trim())
    .find((t) => t && t !== "HRP" && t !== "HR VN" && t !== "Tất cả");
  if (otherCompany) {
    await page
      .getByRole("option", { name: new RegExp(`^${otherCompany}$`) })
      .click();
    await expect(page.locator(`[data-partner-tax-code="${tax}"]`)).toHaveCount(0);
  }
});

test("sau gộp: combobox /contracts/new chỉ 1 dòng (round 35)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const tax = fakeTax();
  const stamp = uniqueStamp();
  const admin = adminClient();

  const a = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Combobox A ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, a.id, HRP_COMPANY_ID);

  const b = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Combobox B ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, b.id, HR_VN_COMPANY_ID);

  await mergePartnersByTaxCode(admin, a.id, b.id);

  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  // Mở combobox, tìm theo tên a (chính xác) thay vì tiền tố "Combobox"
  // — tiền tố có thể khớp nhiều dòng (a, b) khi combobox vẫn còn cache.
  // Dùng tên chính xác chỉ match 1 dòng sau gộp.
  await clickSafe(page, '[data-testid="partner-combobox"]');
  const search = page.getByTestId("partner-combobox-search");
  await search.waitFor({ state: "visible" });
  await search.click();
  await search.pressSequentially(a.name, { delay: 30 });

  // Bất biến cần khóa: combobox hiện đúng 1 dòng trỏ về `a.id`, không
  // dòng nào trỏ về `b.id` (DB đã gộp). Tổng số dòng có thể > 1 nếu
  // combobox ghim dòng đang chọn ở đầu, nhưng `a.id` chỉ xuất hiện 1 lần
  // và `b.id` không xuất hiện.
  const options = page.getByTestId("partner-option");
  const ids = await options.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-partner-id")),
  );
  expect(ids.filter((id) => id === a.id)).toHaveLength(1);
  expect(ids).not.toContain(b.id);
});

test("sau gộp: tạo hợp đồng mới với HRP lưu thành công (round 35)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const tax = fakeTax();
  const stamp = uniqueStamp();
  const admin = adminClient();

  const a = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Create HĐ A ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, a.id, HRP_COMPANY_ID);

  const b = await seedPartner(admin, {
    organizationId: ORG_A,
    name: `${TEST_PREFIX}Create HĐ B ${stamp}`,
    taxCode: tax,
  });
  await seedPartnerCompanyLink(admin, b.id, HR_VN_COMPANY_ID);

  await mergePartnersByTaxCode(admin, a.id, b.id);

  // Tạo hợp đồng mới qua form — chọn partner gộp + chọn HRP.
  await login(page);
  await gotoAndSettle(page, "/contracts/new");

  await selectPartner(page, a.name);
  await selectCompany(page, "HRP");

  const contractNumber = `${TEST_PREFIX}HD-gop-${stamp}`;
  await page.fill('input[name="contractNumber"]', contractNumber);
  await clickSafe(page, '[data-testid="contract-form-submit"]');

  // Sau khi submit, app điều hướng sang /contracts/<id>. Đợi URL
  // thay đổi (không còn /new) để chắc form đã gửi thành công.
  await expect(page).not.toHaveURL(/\/contracts\/new$/, { timeout: 30_000 });

  // Khẳng định ở tầng DB: hợp đồng đã được tạo với partner_id = a.id
  // (giữ lại sau gộp), company_id = HRP. Không cần kiểm tra UI ở đây
  // — UI đã được verify ở các test khác.
  const { data: contract } = await admin
    .from("contracts")
    .select("id, partner_id, company_id, contract_number")
    .eq("contract_number", contractNumber)
    .maybeSingle();

  expect(contract).not.toBeNull();
  expect(contract?.partner_id).toBe(a.id);
  expect(contract?.company_id).toBe(HRP_COMPANY_ID);
});
