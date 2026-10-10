import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, TEST_PREFIX } from "./config";
import {
  adminClient,
  signInAsAdmin,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 29 — the tax-code conflict is company-aware.
 *
 * The same tax code under a COMPLETELY different company is allowed (mirrors
 * the round 25 import rule); an overlap with the caller's companies still
 * blocks. An update without `companyIds` keeps the old strict behaviour.
 */

const suite = hasLiveBackend ? describe : describe.skip;

const HRP = "00000000-0000-4000-8000-000000000001";
const HR_VN = "00000000-0000-4000-8000-000000000002";

suite("partner tax-code conflict — company-aware (round 29)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;

  const stamp = Date.now().toString(36);
  const numeric = String(Date.now()).slice(-8);

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    orgA = await signInAsAdmin();
  }, 180_000);

  afterAll(async () => {
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  async function createViaProbe(input: Record<string, unknown>) {
    const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: orgA.cookie },
      body: JSON.stringify({ action: "create_partner", payload: input }),
    });
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as {
        ok: boolean;
        code?: string;
        message?: string;
        data?: { id: string };
      },
    };
  }

  async function updateViaProbe(id: string, input: Record<string, unknown>) {
    const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: orgA.cookie },
      body: JSON.stringify({ action: "update_partner", payload: { id, input } }),
    });
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as {
        ok: boolean;
        code?: string;
        message?: string;
        data?: { id: string };
      },
    };
  }

  function createInput(name: string, taxCode: string, companyIds: string[]) {
    return {
      name,
      address: "",
      taxCode,
      region: "",
      abbreviation: "",
      status: "active",
      companyIds,
    };
  }

  it("allows the same tax code under a completely different company", async () => {
    const tax = `71${numeric}`;

    const first = await createViaProbe(
      createInput(`${TEST_PREFIX}MST khác công ty A ${stamp}`, tax, [HRP]),
    );
    expect(first.body.ok).toBe(true);

    const second = await createViaProbe(
      createInput(`${TEST_PREFIX}MST khác công ty B ${stamp}`, tax, [HR_VN]),
    );
    expect(second.body.ok).toBe(true);

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("tax_code", tax);
    expect(data).toHaveLength(2);
  }, 120_000);

  it("still refuses the same tax code under an overlapping company", async () => {
    const tax = `72${numeric}`;

    await createViaProbe(createInput(`${TEST_PREFIX}MST trùng A ${stamp}`, tax, [HRP]));

    const again = await createViaProbe(
      createInput(`${TEST_PREFIX}MST trùng B ${stamp}`, tax, [HRP]),
    );
    expect(again.body.ok).toBe(false);
    expect(again.body.code).toBe("validation");
    expect(again.body.message).toContain("Mã số thuế đã được dùng");
  }, 120_000);

  it("update moves the tax code to another partner's code when the companies differ", async () => {
    const taxP1 = `73${numeric}`;
    const taxP2 = `74${numeric}`;

    const p1 = await createViaProbe(
      createInput(`${TEST_PREFIX}Đổi MST A ${stamp}`, taxP1, [HRP]),
    );
    await createViaProbe(
      createInput(`${TEST_PREFIX}Đổi MST B ${stamp}`, taxP2, [HR_VN]),
    );

    const updated = await updateViaProbe(p1.body.data!.id, {
      taxCode: taxP2,
      companyIds: [HRP],
    });
    expect(updated.body.ok).toBe(true);

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("tax_code", taxP2);
    expect(data).toHaveLength(2);
  }, 120_000);

  it("update still refuses the same company's tax code", async () => {
    const taxP1 = `75${numeric}`;
    const taxP3 = `76${numeric}`;

    const p1 = await createViaProbe(
      createInput(`${TEST_PREFIX}Chặn đổi MST A ${stamp}`, taxP1, [HRP]),
    );
    await createViaProbe(
      createInput(`${TEST_PREFIX}Chặn đổi MST B ${stamp}`, taxP3, [HRP]),
    );

    const updated = await updateViaProbe(p1.body.data!.id, {
      taxCode: taxP3,
      companyIds: [HRP],
    });
    expect(updated.body.ok).toBe(false);
    expect(updated.body.code).toBe("validation");
    expect(updated.body.message).toContain("Mã số thuế đã được dùng");
  }, 120_000);

  it("update without companyIds keeps the old strict behaviour", async () => {
    const taxP1 = `77${numeric}`;
    const taxP3 = `78${numeric}`;

    const p1 = await createViaProbe(
      createInput(`${TEST_PREFIX}Không công ty A ${stamp}`, taxP1, [HRP]),
    );
    await createViaProbe(
      createInput(`${TEST_PREFIX}Không công ty B ${stamp}`, taxP3, [HR_VN]),
    );

    // No companyIds → even a different company blocks (conservative).
    const updated = await updateViaProbe(p1.body.data!.id, { taxCode: taxP3 });
    expect(updated.body.ok).toBe(false);
    expect(updated.body.message).toContain("Mã số thuế đã được dùng");
  }, 120_000);
});
