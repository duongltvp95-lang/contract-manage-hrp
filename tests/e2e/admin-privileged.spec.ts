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
  sweep,
} from "./helpers";

test.skip(!hasLiveBackend, "Supabase/R2 credentials are not configured");

/**
 * Round 19 — the owner-only delete / unarchive / archived-tab flows.
 *
 * The Playwright webServer injects `DELETE_ADMIN_EMAILS` containing the e2e admin
 * (e2e.wave2@hrpartner.vn), so this suite exercises the privileged path. A
 * throwaway regular user is created on the fly for the forbidden checks.
 */

const HRP = "00000000-0000-4000-8000-000000000001";

async function seedPartner(admin: ReturnType<typeof adminClient>, name: string): Promise<string> {
  const { data } = await admin
    .from("partners")
    .insert({ organization_id: ORG_A, name })
    .select("id")
    .single();
  await admin.from("partner_companies").insert({ partner_id: data!.id, company_id: HRP });
  return data!.id as string;
}

async function seedContract(
  admin: ReturnType<typeof adminClient>,
  contractNumber: string,
  partnerId: string | null,
): Promise<string> {
  const { data } = await admin
    .from("contracts")
    .insert({
      organization_id: ORG_A,
      contract_number: contractNumber,
      partner_id: partnerId,
    })
    .select("id")
    .single();
  return data!.id as string;
}

test.describe("admin privileged (round 19)", () => {
  let startedAt: string;

  test.beforeAll(async () => {
    startedAt = new Date().toISOString();
    await sweep(adminClient());
  });

  test.afterAll(async () => {
    const admin = adminClient();
    // The delete/unarchive actions write audit rows; the sweep below does not
    // (it deletes through the service role), so those rows are cleaned here.
    await admin
      .from("audit_logs")
      .delete()
      .in("action", ["delete_contract", "delete_partner", "unarchive_contract"])
      .gte("created_at", startedAt);
    await sweep(admin);
  });

  test("the archived tab + unarchive flow", async ({ page }) => {
    const stamp = runId();
    const admin = adminClient();
    const partnerId = await seedPartner(admin, `${TEST_PREFIX}Đối tác unarchive ${stamp}`);
    const contractNumber = `${TEST_PREFIX}HD unarchive ${stamp}`;
    await seedContract(admin, contractNumber, partnerId);
    await admin.from("contracts").update({ archived_at: new Date().toISOString() }).eq("contract_number", contractNumber);

    await login(page);
    await gotoAndSettle(page, "/contracts");

    // The archived tab is visible to the privileged admin.
    await expect(page.getByTestId("contract-tab-archived")).toBeVisible();
    await clickSafe(page, '[data-testid="contract-tab-archived"]');
    await expect(page).toHaveURL(/scope=archived/);
    await expect(page.getByRole("row").filter({ hasText: contractNumber })).toBeVisible();

    // Open the detail and unarchive.
    await page.getByRole("row").filter({ hasText: contractNumber }).getByRole("link").first().click();
    await expect(page.getByTestId("contract-unarchive")).toBeVisible();
    await clickSafe(page, '[data-testid="contract-unarchive"]');
    await expect(page.getByText("Đã bỏ lưu trữ")).toBeVisible({ timeout: 15_000 });

    // Back on the active tab, the contract is gone from archived.
    await gotoAndSettle(page, "/contracts?scope=archived");
    await expect(page.getByRole("row").filter({ hasText: contractNumber })).toHaveCount(0);
  });

  test("deletes a contract with a file", async ({ page }) => {
    const stamp = runId();
    const admin = adminClient();
    const partnerId = await seedPartner(admin, `${TEST_PREFIX}Đối tác xoá HD ${stamp}`);
    const contractNumber = `${TEST_PREFIX}HD xoá ${stamp}`;
    const contractId = await seedContract(admin, contractNumber, partnerId);
    // A file row (the R2 object delete is idempotent, so a fake key is enough).
    await admin.from("contract_files").insert({
      organization_id: ORG_A,
      contract_id: contractId,
      bucket: "contracts",
      object_key: `contracts/${ORG_A}/${contractId}/fake.pdf`,
      original_filename: "fake.pdf",
      mime_type: "application/pdf",
      file_size: 10,
    });

    await login(page);
    await gotoAndSettle(page, "/contracts");

    const row = page.getByRole("row").filter({ hasText: contractNumber });
    await expect(row).toBeVisible();
    await clickSafe(page, `[data-testid="contract-delete-${contractId}"]`);
    await clickSafe(page, '[data-testid="contract-delete-confirm"]');
    await expect(page.getByText("Đã xoá hợp đồng")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("row").filter({ hasText: contractNumber })).toHaveCount(0);
  });

  test("deletes a partner, and blocks one that still has contracts", async ({ page }) => {
    const stamp = runId();
    const admin = adminClient();

    const freePartner = await seedPartner(admin, `${TEST_PREFIX}Đối tác xoá trơn ${stamp}`);
    const busyPartner = await seedPartner(admin, `${TEST_PREFIX}Đối tác bận ${stamp}`);
    await seedContract(admin, `${TEST_PREFIX}HD chặn xoá ${stamp}`, busyPartner);

    await login(page);
    await gotoAndSettle(page, "/partners");

    // Deleting a free partner works.
    await clickSafe(page, `[data-testid="partner-delete-${freePartner}"]`);
    await clickSafe(page, '[data-testid="partner-delete-confirm"]');
    await expect(page.getByText("Đã xoá đối tác")).toBeVisible({ timeout: 15_000 });

    // Deleting a partner with contracts is blocked with a clear message.
    await clickSafe(page, `[data-testid="partner-delete-${busyPartner}"]`);
    await clickSafe(page, '[data-testid="partner-delete-confirm"]');
    await expect(page.getByText(/không thể xoá/)).toBeVisible({ timeout: 15_000 });
  });

  test("a regular user sees no delete controls and cannot view archived", async ({ page }) => {
    const stamp = runId();
    const admin = adminClient();

    // A throwaway regular user (role = user).
    const email = `e2e.user.${stamp}@hrpartner.test`;
    const password = `User-${stamp}!aA1`;
    await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const { data: user } = await admin.auth.admin.listUsers({ perPage: 200 });
    const created = user?.users?.find((u) => u.email === email);
    if (created) {
      await admin.from("profiles").update({ role: "user", is_active: true }).eq("id", created.id);
    }

    // An archived contract.
    const partnerId = await seedPartner(admin, `${TEST_PREFIX}Đối tác cấm xem ${stamp}`);
    const contractNumber = `${TEST_PREFIX}HD cấm xem ${stamp}`;
    const contractId = await seedContract(admin, contractNumber, partnerId);
    await admin.from("contracts").update({ archived_at: new Date().toISOString() }).eq("id", contractId);

    await login(page, email, password);
    await gotoAndSettle(page, "/contracts");

    // No archived tab, no delete buttons.
    await expect(page.getByTestId("contract-tab-archived")).toHaveCount(0);
    await expect(page.locator('[data-testid^="contract-delete-"]')).toHaveCount(0);

    // Partners list has no delete button either.
    await gotoAndSettle(page, "/partners");
    await expect(page.locator('[data-testid^="partner-delete-"]')).toHaveCount(0);

    // The archived contract's detail is forbidden.
    await gotoAndSettle(page, `/contracts/${contractId}`);
    await expect(page.getByTestId("contract-archived-forbidden")).toBeVisible();

    // Clean up the throwaway user.
    await admin.auth.admin.deleteUser(created?.id ?? "");
  });
});
