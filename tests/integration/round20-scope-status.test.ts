import { addDays, format } from "date-fns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Round 20, part 1 — contract scope (active/expired/archived) + partner status.
 */

const suite = hasLiveBackend ? describe : describe.skip;

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

async function seedContract(
  admin: SupabaseClient,
  contractNumber: string,
  expiryDate: string | null,
  archived = false,
): Promise<string> {
  const { data } = await admin
    .from("contracts")
    .insert({
      organization_id: ORG_B,
      contract_number: contractNumber,
      expiry_date: expiryDate,
      archived_at: archived ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  return data!.id as string;
}

async function seedPartner(
  admin: SupabaseClient,
  name: string,
  status: "active" | "stopped",
): Promise<string> {
  const { data } = await admin
    .from("partners")
    .insert({ organization_id: ORG_B, name, status })
    .select("id")
    .single();
  return data!.id as string;
}

suite("round 20 — contract scope + partner status", () => {
  let admin: SupabaseClient;
  let session: TestSession;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    session = await createSecondTenant(admin, "r20");
  }, 180_000);

  afterAll(async () => {
    if (session) await destroySecondTenant(admin, session);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("scope=expired returns only expired; active excludes expired", async () => {
    const today = new Date();
    const expiredDate = format(addDays(today, -3), "yyyy-MM-dd");
    const activeDate = format(addDays(today, 3), "yyyy-MM-dd");
    const stamp = Date.now().toString(36);

    const expiredId = await seedContract(admin, `${TEST_PREFIX}HD hết hạn ${stamp}`, expiredDate);
    const activeId = await seedContract(admin, `${TEST_PREFIX}HD chưa hết hạn ${stamp}`, activeDate);
    const archivedId = await seedContract(admin, `${TEST_PREFIX}HD lưu trữ ${stamp}`, activeDate, true);

    const expired = await probe(session, "list_contracts", { scope: "expired", pageSize: 50 });
    expect(expired.ok).toBe(true);
    const expiredRows = (expired.data as { rows: { id: string }[] }).rows;
    expect(expiredRows.some((r) => r.id === expiredId)).toBe(true);
    expect(expiredRows.some((r) => r.id === activeId)).toBe(false);
    expect(expiredRows.some((r) => r.id === archivedId)).toBe(false);

    const active = await probe(session, "list_contracts", { scope: "active", pageSize: 50 });
    expect(active.ok).toBe(true);
    const activeRows = (active.data as { rows: { id: string }[] }).rows;
    expect(activeRows.some((r) => r.id === activeId)).toBe(true);
    expect(activeRows.some((r) => r.id === expiredId)).toBe(false);
    expect(activeRows.some((r) => r.id === archivedId)).toBe(false);

    const archived = await probe(session, "list_contracts", { scope: "archived", pageSize: 50 });
    expect(archived.ok).toBe(true);
    const archivedRows = (archived.data as { rows: { id: string }[] }).rows;
    expect(archivedRows.some((r) => r.id === archivedId)).toBe(true);
    expect(archivedRows.some((r) => r.id === expiredId)).toBe(false);
  }, 120_000);

  it("scope=expired default-sorts by expiry_date desc", async () => {
    const today = new Date();
    const older = format(addDays(today, -10), "yyyy-MM-dd");
    const newer = format(addDays(today, -1), "yyyy-MM-dd");
    const stamp = Date.now().toString(36);

    const olderId = await seedContract(admin, `${TEST_PREFIX}HD cũ ${stamp}`, older);
    const newerId = await seedContract(admin, `${TEST_PREFIX}HD mới ${stamp}`, newer);

    const expired = await probe(session, "list_contracts", { scope: "expired", pageSize: 50 });
    expect(expired.ok).toBe(true);
    const rows = (expired.data as { rows: { id: string }[] }).rows;
    const ours = rows.filter((r) => r.id === olderId || r.id === newerId);
    expect(ours.map((r) => r.id)).toEqual([newerId, olderId]);
  }, 120_000);

  it("listPartners filters by status; no status returns all", async () => {
    const stamp = Date.now().toString(36);
    const activeId = await seedPartner(admin, `${TEST_PREFIX}ĐT đang ${stamp}`, "active");
    const stoppedId = await seedPartner(admin, `${TEST_PREFIX}ĐT dừng ${stamp}`, "stopped");

    const stopped = await probe(session, "list_partners", { status: "stopped" });
    expect(stopped.ok).toBe(true);
    const stoppedRows = (stopped.data as { id: string }[]);
    expect(stoppedRows.some((r) => r.id === stoppedId)).toBe(true);
    expect(stoppedRows.some((r) => r.id === activeId)).toBe(false);

    const all = await probe(session, "list_partners");
    expect(all.ok).toBe(true);
    const allRows = (all.data as { id: string }[]);
    expect(allRows.some((r) => r.id === stoppedId)).toBe(true);
    expect(allRows.some((r) => r.id === activeId)).toBe(true);

    // Cross-org: an org-A partner never leaks into the org-B directory.
    const { data: orgAPartner } = await admin
      .from("partners")
      .select("id")
      .eq("organization_id", ORG_A)
      .limit(1)
      .maybeSingle();
    if (orgAPartner) {
      expect(allRows.some((r) => r.id === orgAPartner.id)).toBe(false);
    }
  }, 120_000);
});
