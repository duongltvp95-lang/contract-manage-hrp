import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 21, part 1 — partner region + abbreviation (DB + service).
 */

const suite = hasLiveBackend ? describe : describe.skip;

const ORG_B_HRP = "22222222-0000-4000-8000-000000000001";

type ProbeResult = { ok?: boolean; data?: unknown; message?: string };

async function probe(
  session: TestSession,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<ProbeResult> {
  const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return response.json().catch(() => ({}));
}

suite("round 21 — partner region + abbreviation", () => {
  let admin: SupabaseClient;
  let session: TestSession;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    session = await createSecondTenant(admin, "r21");
  }, 180_000);

  afterAll(async () => {
    if (session) await destroySecondTenant(admin, session);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("create + list + get return region and abbreviation", async () => {
    const stamp = Date.now().toString(36);
    const created = await probe(session, "create_partner", {
      name: `${TEST_PREFIX}ĐT vùng ${stamp}`,
      region: "Miền Bắc",
      abbreviation: "DK",
      companyIds: [ORG_B_HRP],
    });
    expect(created.ok).toBe(true);
    const partnerId = (created.data as { id: string }).id;

    const list = await probe(session, "list_partners");
    expect(list.ok).toBe(true);
    const row = (list.data as { id: string; region: string | null; abbreviation: string | null }[]).find(
      (r) => r.id === partnerId,
    );
    expect(row?.region).toBe("Miền Bắc");
    expect(row?.abbreviation).toBe("DK");

    const got = await probe(session, "get_partner", { id: partnerId });
    expect(got.ok).toBe(true);
    expect((got.data as { region: string | null }).region).toBe("Miền Bắc");
    expect((got.data as { abbreviation: string | null }).abbreviation).toBe("DK");
  }, 120_000);

  it("update writes the new fields and the audit changed lists them", async () => {
    const stamp = Date.now().toString(36);
    const created = await probe(session, "create_partner", {
      name: `${TEST_PREFIX}ĐT sửa vùng ${stamp}`,
      companyIds: [ORG_B_HRP],
    });
    expect(created.ok).toBe(true);
    const partnerId = (created.data as { id: string }).id;

    const updated = await probe(session, "update_partner", {
      id: partnerId,
      input: { region: "Miền Trung", abbreviation: "MT" },
    });
    expect(updated.ok).toBe(true);
    expect((updated.data as { region: string | null }).region).toBe("Miền Trung");
    expect((updated.data as { abbreviation: string | null }).abbreviation).toBe("MT");

    // The audit row is read via the service-role client (the second-tenant user
    // is not an admin, so `list_logs` would refuse it).
    const { data: auditRows } = await admin
      .from("audit_logs")
      .select("metadata")
      .eq("action", "update_partner")
      .eq("target_id", partnerId);
    const changed = (auditRows?.[0]?.metadata as { changed?: string[] } | undefined)
      ?.changed;
    expect(changed).toContain("region");
    expect(changed).toContain("abbreviation");
  }, 120_000);

  it("search matches the abbreviation (diacritics-folded), not the region", async () => {
    const stamp = Date.now().toString(36);
    const created = await probe(session, "create_partner", {
      name: `${TEST_PREFIX}ĐT tìm ${stamp}`,
      abbreviation: "ĐK",
      region: "Miền Nam",
      companyIds: [ORG_B_HRP],
    });
    expect(created.ok).toBe(true);
    const partnerId = (created.data as { id: string }).id;

    // "dk" (unaccented) folds to the abbreviation "ĐK".
    const byAbbr = await probe(session, "search_partners", { term: "dk" });
    expect(byAbbr.ok).toBe(true);
    expect((byAbbr.data as { id: string }[]).some((r) => r.id === partnerId)).toBe(true);

    // Region is deliberately NOT part of the quick search.
    const byRegion = await probe(session, "search_partners", { term: "miền nam" });
    expect(byRegion.ok).toBe(true);
    expect((byRegion.data as { id: string }[]).some((r) => r.id === partnerId)).toBe(false);
  }, 120_000);
});
