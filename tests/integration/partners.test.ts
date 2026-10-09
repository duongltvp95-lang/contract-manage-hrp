import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, ORG_B, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  seedContractWithFile,
  seedPartner,
  signInAsAdmin,
  sweepTestRows,
  type SeededFile,
  type SeededPartner,
  type TestSession,
} from "./helpers";

/**
 * Feature round 2, part 1 — partners.
 *
 * Two layers are asserted deliberately:
 *
 *   * the RLS rules at the PostgREST layer, because that is where an attacker
 *     with a stolen token actually talks to the database;
 *   * the search behaviour through the real server, because "search by partner
 *     name" is a query the service builds, not something RLS can prove.
 *
 * The no-delete rules are the centrepiece: a partner is referenced by contracts,
 * so a client-side delete must be impossible twice over — no DELETE grant and no
 * DELETE policy.
 */

const suite = hasLiveBackend ? describe : describe.skip;

suite("partners — RLS and search (feature round 2)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;

  let partnerA: SeededPartner;
  let partnerB: SeededPartner;
  let contractWithPartner: SeededFile;
  let contractFreeText: SeededFile;

  const stamp = Date.now().toString(36);
  const searchableName = `${TEST_PREFIX}Đối tác Alpha ${stamp}`;
  const freeTextName = `${TEST_PREFIX}Đối tác Beta ${stamp}`;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "partners");

    partnerA = await seedPartner(admin, {
      organizationId: ORG_A,
      name: searchableName,
    });
    partnerB = await seedPartner(admin, {
      organizationId: ORG_B,
      name: `${TEST_PREFIX}Đối tác của tenant B ${stamp}`,
    });

    // One contract linked to the partner, one with free text only, and one in
    // the other tenant linked to its own partner. The three together are what
    // tell "matched through the join" apart from "matched the number" and from
    // "leaked across organizations".
    contractWithPartner = await seedContractWithFile(admin, {
      organizationId: ORG_A,
      label: `PARTNER-LINKED-${stamp}`,
      withObject: false,
      partnerId: partnerA.id,
    });
    contractFreeText = await seedContractWithFile(admin, {
      organizationId: ORG_A,
      label: `PARTNER-TEXT-${stamp}`,
      withObject: false,
    });
    // Its own cleanup is `destroySecondTenant`'s job.
    await seedContractWithFile(admin, {
      organizationId: ORG_B,
      label: `PARTNER-ORGB-${stamp}`,
      withObject: false,
      partnerId: partnerB.id,
    });

    // A partner_text that appears in no contract number, so a match on it can
    // only have come from the free-text column.
    await admin
      .from("contracts")
      .update({ partner_text: freeTextName })
      .eq("id", contractFreeText.contractId);
  }, 180_000);

  afterAll(async () => {
    if (contractWithPartner) await contractWithPartner.cleanup();
    if (contractFreeText) await contractFreeText.cleanup();
    if (partnerA) await partnerA.cleanup();
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  // -------------------------------------------------------------------------
  // RLS
  // -------------------------------------------------------------------------

  it("reads its own partner", async () => {
    const { data, error } = await orgA.client
      .from("partners")
      .select("id, name")
      .eq("id", partnerA.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe(searchableName);
  });

  it("cannot see another organization's partner", async () => {
    const { data } = await orgA.client
      .from("partners")
      .select("id, name")
      .eq("id", partnerB.id);

    expect(data ?? []).toHaveLength(0);
  });

  it("cannot see another organization's partner in an unfiltered listing", async () => {
    const { data } = await orgA.client.from("partners").select("id, organization_id");

    expect((data ?? []).every((row) => row.organization_id === ORG_A)).toBe(true);
    expect((data ?? []).map((row) => row.id)).not.toContain(partnerB.id);
  });

  it("creates a partner for its own organization", async () => {
    const { data, error } = await orgA.client
      .from("partners")
      .insert({ organization_id: ORG_A, name: `${TEST_PREFIX}CREATED-${stamp}` })
      .select("id, organization_id")
      .single();

    expect(error).toBeNull();
    expect(data?.organization_id).toBe(ORG_A);

    await admin.from("partners").delete().eq("id", data?.id);
  });

  it("refuses to create a partner inside another organization", async () => {
    const { data, error } = await orgA.client
      .from("partners")
      .insert({ organization_id: ORG_B, name: `${TEST_PREFIX}WRONG-ORG-${stamp}` })
      .select("id");

    // Either the policy rejects the write or the row is not returned; a row in
    // org B must not exist either way.
    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.message).toMatch(/policy|denied|permission/i);

    const { data: leaked } = await admin
      .from("partners")
      .select("id")
      .eq("organization_id", ORG_B)
      .like("name", `${TEST_PREFIX}WRONG-ORG-%`);

    expect(leaked ?? []).toHaveLength(0);
  });

  it("cannot rename another organization's partner", async () => {
    const { data } = await orgA.client
      .from("partners")
      .update({ name: "hijacked" })
      .eq("id", partnerB.id)
      .select("id");

    expect(data ?? []).toHaveLength(0);

    const { data: unchanged } = await admin
      .from("partners")
      .select("name")
      .eq("id", partnerB.id)
      .single();

    expect(unchanged?.name).toBe(partnerB.name);
  });

  it("renames its own partner", async () => {
    const { data, error } = await orgA.client
      .from("partners")
      .update({ name: `${TEST_PREFIX}TEMP-NAME-${stamp}` })
      .eq("id", partnerA.id)
      .select("id, name")
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe(`${TEST_PREFIX}TEMP-NAME-${stamp}`);

    // Put it back: the search tests below depend on the original name.
    await admin.from("partners").update({ name: searchableName }).eq("id", partnerA.id);
  });

  // -------------------------------------------------------------------------
  // The constraint that matters most: there is no delete path
  // -------------------------------------------------------------------------

  it("cannot DELETE its own partner — no grant, no policy", async () => {
    const { data, error } = await orgA.client
      .from("partners")
      .delete()
      .eq("id", partnerA.id)
      .select("id");

    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.message).toMatch(/permission|denied|policy/i);

    const { data: stillThere } = await admin
      .from("partners")
      .select("id")
      .eq("id", partnerA.id)
      .maybeSingle();

    expect(stillThere?.id).toBe(partnerA.id);
  });

  it("cannot DELETE another organization's partner either", async () => {
    const { data } = await orgA.client
      .from("partners")
      .delete()
      .eq("id", partnerB.id)
      .select("id");

    expect(data ?? []).toHaveLength(0);

    const { data: stillThere } = await admin
      .from("partners")
      .select("id")
      .eq("id", partnerB.id)
      .maybeSingle();

    expect(stillThere?.id).toBe(partnerB.id);
  });

  it("refuses a partner delete even for service_role while a contract points at it", async () => {
    // The FK is RESTRICT on purpose: removing a partner that contracts reference
    // must be an explicit decision taken with those contracts in view, not a
    // side effect. This is the database agreeing.
    const { error } = await admin.from("partners").delete().eq("id", partnerA.id);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/foreign key|violates|constraint/i);
  });

  // -------------------------------------------------------------------------
  // Search — through the real server
  // -------------------------------------------------------------------------

  async function searchViaServer(term: string): Promise<string> {
    const response = await fetch(
      `${BASE_URL}/contracts?q=${encodeURIComponent(term)}`,
      { headers: { cookie: orgA.cookie } },
    );

    expect(response.status).toBe(200);
    return response.text();
  }

  it("finds a contract by its linked partner's name", async () => {
    // Neither this contract's number nor its partner_text contains "Alpha", so a
    // match can only have come through the partner link.
    const html = await searchViaServer(`Alpha ${stamp}`);

    expect(html).toContain(`${TEST_PREFIX}PARTNER-LINKED-${stamp}`);
    // …and the free-text contract is genuinely a different row, not a match on
    // the same query.
    expect(html).not.toContain(`${TEST_PREFIX}PARTNER-TEXT-${stamp}`);
  });

  it("still finds a contract by its free-text partner name", async () => {
    // "Beta" appears only in partner_text — not in any contract number.
    const html = await searchViaServer(`Beta ${stamp}`);

    expect(html).toContain(`${TEST_PREFIX}PARTNER-TEXT-${stamp}`);
    expect(html).not.toContain(`${TEST_PREFIX}PARTNER-LINKED-${stamp}`);
  });

  it("does not leak another organization's partner through search", async () => {
    const html = await searchViaServer(`tenant B ${stamp}`);

    // The other tenant has a partner and a contract matching that name; neither
    // may appear for this user.
    expect(html).not.toContain(partnerB.name);
    expect(html).not.toContain(`${TEST_PREFIX}PARTNER-ORGB-${stamp}`);
    expect(html).not.toContain(`${TEST_PREFIX}PARTNER-LINKED-${stamp}`);
  });

  // -------------------------------------------------------------------------
  // Quick search (round 6) — through the real server
  // -------------------------------------------------------------------------

  async function probePartnerSearch(term: string, cookie: string) {
    const response = await fetch(`${BASE_URL}/api/partners-contracts-probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ action: "search", term }),
    });

    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as {
        id: string;
        name: string;
        tax_code: string | null;
      }[],
    };
  }

  it("quick search finds a partner by accented name (round 6)", async () => {
    const result = await probePartnerSearch(`Đối tác Alpha ${stamp}`, orgA.cookie);

    expect(result.status).toBe(200);
    expect(result.body.some((row) => row.id === partnerA.id)).toBe(true);
  });

  it("quick search finds a partner by unaccented name (round 6)", async () => {
    // "doi tac alpha" has no diacritics at all — the RPC folds the stored name
    // the same way the client filter does, so it must still match.
    const result = await probePartnerSearch(`doi tac alpha ${stamp}`, orgA.cookie);

    expect(result.status).toBe(200);
    expect(result.body.some((row) => row.id === partnerA.id)).toBe(true);
  });

  it("quick search finds a partner by tax code (round 6)", async () => {
    const taxCode = `99${stamp.slice(-8)}`;
    await admin
      .from("partners")
      .update({ tax_code: taxCode })
      .eq("id", partnerA.id);

    const result = await probePartnerSearch(taxCode, orgA.cookie);

    expect(result.status).toBe(200);
    expect(result.body.some((row) => row.id === partnerA.id)).toBe(true);
  });

  it("quick search does not leak another organization's partners (round 6)", async () => {
    const result = await probePartnerSearch(`tenant B ${stamp}`, orgA.cookie);

    expect(result.status).toBe(200);
    expect(result.body.some((row) => row.id === partnerB.id)).toBe(false);
  });

  it("quick search refuses an anonymous caller (round 6)", async () => {
    const response = await fetch(`${BASE_URL}/api/partners-contracts-probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", term: "alpha" }),
    });

    expect(response.status).toBe(401);
  });
});

suite("partners — contract-count filter (round 28)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;

  let withContract: SeededPartner;
  let withoutContract: SeededPartner;
  let stoppedWithContract: SeededPartner;

  const stamp = Date.now().toString(36);

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);
    orgA = await signInAsAdmin();

    withContract = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Có HĐ ${stamp}`,
    });
    withoutContract = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Không HĐ ${stamp}`,
    });
    stoppedWithContract = await seedPartner(admin, {
      organizationId: ORG_A,
      name: `${TEST_PREFIX}Dừng có HĐ ${stamp}`,
    });
    await admin
      .from("partners")
      .update({ status: "stopped" })
      .eq("id", stoppedWithContract.id);

    await admin.from("contracts").insert([
      {
        organization_id: ORG_A,
        contract_number: `${TEST_PREFIX}HĐ1 ${stamp}`,
        partner_id: withContract.id,
      },
      {
        organization_id: ORG_A,
        contract_number: `${TEST_PREFIX}HĐ2 ${stamp}`,
        partner_id: stoppedWithContract.id,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  async function listViaProbe(
    contracts?: "has" | "none",
    status?: "active" | "stopped",
  ) {
    const response = await fetch(`${BASE_URL}/api/audit-business-probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: orgA.cookie },
      body: JSON.stringify({
        action: "list_partners",
        payload: { contracts, status },
      }),
    });

    return (await response.json().catch(() => null)) as {
      ok: boolean;
      data?: { id: string }[];
    };
  }

  it('"has" returns only partners with contracts', async () => {
    const result = await listViaProbe("has");
    expect(result.ok).toBe(true);
    const ids = (result.data ?? []).map((partner) => partner.id);
    expect(ids).toContain(withContract.id);
    expect(ids).toContain(stoppedWithContract.id);
    expect(ids).not.toContain(withoutContract.id);
  });

  it('"none" returns only partners without contracts', async () => {
    const result = await listViaProbe("none");
    const ids = (result.data ?? []).map((partner) => partner.id);
    expect(ids).toContain(withoutContract.id);
    expect(ids).not.toContain(withContract.id);
    expect(ids).not.toContain(stoppedWithContract.id);
  });

  it("combines with the status filter", async () => {
    const result = await listViaProbe("has", "stopped");
    const ids = (result.data ?? []).map((partner) => partner.id);
    expect(ids).toContain(stoppedWithContract.id);
    expect(ids).not.toContain(withContract.id);
    expect(ids).not.toContain(withoutContract.id);
  });

  it("absent filter returns everything", async () => {
    const result = await listViaProbe();
    const ids = (result.data ?? []).map((partner) => partner.id);
    expect(ids).toContain(withContract.id);
    expect(ids).toContain(withoutContract.id);
    expect(ids).toContain(stoppedWithContract.id);
  });
});
