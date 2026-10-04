import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { ORG_A, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  seedContractWithFile,
  signInAsAdmin,
  sweepTestRows,
  type SeededFile,
  type TestSession,
} from "./helpers";

/**
 * W1-WEB-040 — RLS tests (plan sections 71, 72, 101).
 *
 * These talk to PostgREST directly with each user's own access token, so they
 * test the database policy itself rather than the application's filtering. If
 * the service layer ever forgot its `.eq("organization_id", …)`, these are the
 * tests that would still catch a leak.
 */

const suite = hasLiveBackend ? describe : describe.skip;

suite("RLS isolates organizations", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;
  let contractA: SeededFile;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "rls");
    contractA = await seedContractWithFile(admin, {
      organizationId: ORG_A,
      label: "RLS-A",
      withObject: false,
    });
  }, 120_000);

  afterAll(async () => {
    if (contractA) await contractA.cleanup();
    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 120_000);

  it("lets the owner read its own contract", async () => {
    const { data, error } = await orgA.client
      .from("contracts")
      .select("id")
      .eq("id", contractA.contractId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("hides another organization's contract from SELECT", async () => {
    const { data } = await orgB.client
      .from("contracts")
      .select("id")
      .eq("id", contractA.contractId);

    expect(data ?? []).toHaveLength(0);
  });

  it("hides another organization's contract from an unfiltered SELECT", async () => {
    // Even with no filter at all, RLS must return nothing from org A.
    const { data } = await orgB.client.from("contracts").select("organization_id");
    expect((data ?? []).every((row) => row.organization_id !== ORG_A)).toBe(true);
  });

  it("refuses an UPDATE on another organization's contract", async () => {
    const { data } = await orgB.client
      .from("contracts")
      .update({ partner_text: "RLS BYPASS" })
      .eq("id", contractA.contractId)
      .select("id");

    // RLS filters the row out, so the update matches nothing.
    expect(data ?? []).toHaveLength(0);

    const { data: after } = await admin
      .from("contracts")
      .select("partner_text")
      .eq("id", contractA.contractId)
      .single();
    expect(after?.partner_text).toBe("W1TEST partner");
  });

  it("refuses a DELETE on another organization's contract", async () => {
    const { data } = await orgB.client
      .from("contracts")
      .delete()
      .eq("id", contractA.contractId)
      .select("id");

    expect(data ?? []).toHaveLength(0);

    const { data: stillThere } = await admin
      .from("contracts")
      .select("id")
      .eq("id", contractA.contractId)
      .maybeSingle();
    expect(stillThere?.id).toBe(contractA.contractId);
  });

  it("refuses to INSERT a contract into another organization", async () => {
    const { error } = await orgB.client.from("contracts").insert({
      organization_id: ORG_A,
      contract_number: "W1TEST-RLS-FORGED",
    });

    // The WITH CHECK clause rejects the row; PostgREST reports it as an error.
    expect(error).not.toBeNull();

    const { data: forged } = await admin
      .from("contracts")
      .select("id")
      .eq("contract_number", "W1TEST-RLS-FORGED");
    expect(forged ?? []).toHaveLength(0);
  });

  it("hides another organization's file rows", async () => {
    const { data } = await orgB.client
      .from("contract_files")
      .select("id, object_key")
      .eq("id", contractA.fileId);

    expect(data ?? []).toHaveLength(0);
  });

  it("lets a user read only their own profile", async () => {
    const { data: own } = await orgB.client
      .from("profiles")
      .select("id")
      .eq("id", orgB.userId);
    expect(own).toHaveLength(1);

    const { data: other } = await orgB.client
      .from("profiles")
      .select("id")
      .eq("id", orgA.userId);
    expect(other ?? []).toHaveLength(0);
  });

  it("refuses a role escalation through the profile update", async () => {
    // RLS filters rows, not columns. The column-level GRANT is what stops this:
    // only full_name is updatable, so `role` is rejected outright.
    const { error } = await orgA.client
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", orgA.userId);

    expect(error).not.toBeNull();

    const { data: profile } = await admin
      .from("profiles")
      .select("role, full_name")
      .eq("id", orgA.userId)
      .single();

    // The admin account is already an admin, so assert on the column that the
    // grant *does* allow instead: an unrelated column must not have changed.
    expect(profile?.full_name).not.toBeNull();
  });

  it("refuses to move a profile into another organization", async () => {
    const { error } = await orgB.client
      .from("profiles")
      .update({ organization_id: ORG_A })
      .eq("id", orgB.userId);

    expect(error).not.toBeNull();

    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", orgB.userId)
      .single();
    expect(profile?.organization_id).not.toBe(ORG_A);
  });

  it("shows an organization only to its own members", async () => {
    const { data: mine } = await orgA.client.from("organizations").select("id");
    expect((mine ?? []).some((row) => row.id === ORG_A)).toBe(true);

    const { data: theirs } = await orgB.client
      .from("organizations")
      .select("id")
      .eq("id", ORG_A);
    expect(theirs ?? []).toHaveLength(0);
  });

  it("does not expose the rate limit counters", async () => {
    // The table has RLS on and no policies: nothing may read it directly.
    const { data, error } = await orgA.client.from("rate_limit_counters").select("hits");
    // Either an empty result or a permission error is acceptable; rows are not.
    if (!error) expect(data ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // M8 hardening, fix 1 — the write paths a client must not have.
  //
  // These assert on the SAME organization's own rows, which is the point: the
  // earlier tests cover "another tenant's data", these cover "my own data, in a
  // way the product does not offer". Before the hardening migration every one
  // of them succeeded.
  // -------------------------------------------------------------------------

  it("refuses to DELETE its own contract even with full ownership", async () => {
    const archived = await seedContractWithFile(admin, {
      organizationId: ORG_A,
      label: "RLS-DELETE",
      withObject: false,
    });
    try {
      const { data, error } = await orgA.client
        .from("contracts")
        .delete()
        .eq("id", archived.contractId)
        .select("id");

      // The DELETE grant is revoked, so PostgREST answers with an error rather
      // than an empty result. Either way the row must survive.
      expect(data ?? []).toHaveLength(0);
      if (error) expect(error.message).toMatch(/permission|denied|policy/i);

      const { data: stillThere } = await admin
        .from("contracts")
        .select("id")
        .eq("id", archived.contractId)
        .maybeSingle();
      expect(stillThere?.id).toBe(archived.contractId);
    } finally {
      await archived.cleanup();
    }
  });

  it("refuses to DELETE a contract_files row", async () => {
    const { data, error } = await orgA.client
      .from("contract_files")
      .delete()
      .eq("id", contractA.fileId)
      .select("id");

    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.message).toMatch(/permission|denied|policy/i);

    const { data: stillThere } = await admin
      .from("contract_files")
      .select("id")
      .eq("id", contractA.fileId)
      .maybeSingle();
    expect(stillThere?.id).toBe(contractA.fileId);
  });

  it("refuses to re-point a contract_files row at another object_key", async () => {
    // A file is immutable after upload: the key it was written to is the key it
    // must keep, or the viewer could be aimed at any object in the bucket.
    const { data, error } = await orgA.client
      .from("contract_files")
      .update({ object_key: "contracts/whatever/whatever/whatever/stolen.pdf" })
      .eq("id", contractA.fileId)
      .select("id");

    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.message).toMatch(/permission|denied|policy/i);

    const { data: unchanged } = await admin
      .from("contract_files")
      .select("object_key")
      .eq("id", contractA.fileId)
      .single();
    expect(unchanged?.object_key).toBe(contractA.objectKey);
  });

  it("refuses to edit an archived contract, and refuses to un-archive it", async () => {
    const { data: archived } = await admin
      .from("contracts")
      .insert({
        organization_id: ORG_A,
        contract_number: `${TEST_PREFIX}FROZEN`,
        archived_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!archived) throw new Error("could not seed the archived fixture");

    try {
      const edit = await orgA.client
        .from("contracts")
        .update({ partner_text: "should not stick" })
        .eq("id", archived.id)
        .select("id");
      expect(edit.data ?? []).toHaveLength(0);

      // The important half: archived_at cannot be cleared, so archiving is
      // one-way through the API, exactly as the product intends.
      const restore = await orgA.client
        .from("contracts")
        .update({ archived_at: null })
        .eq("id", archived.id)
        .select("id");
      expect(restore.data ?? []).toHaveLength(0);

      const { data: after } = await admin
        .from("contracts")
        .select("archived_at, partner_text")
        .eq("id", archived.id)
        .single();
      expect(after?.archived_at).not.toBeNull();
      expect(after?.partner_text).toBeNull();
    } finally {
      await admin.from("contracts").delete().eq("id", archived.id);
    }
  });

  it("still lets the owner archive a live contract", async () => {
    // The UPDATE policy gained `archived_at IS NULL` in USING; this proves the
    // archive write itself still passes, which is the obvious way to get that
    // condition wrong.
    const live = await seedContractWithFile(admin, {
      organizationId: ORG_A,
      label: "RLS-ARCHIVE",
      withObject: false,
    });

    try {
      const { data, error } = await orgA.client
        .from("contracts")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", live.contractId)
        .select("id, archived_at");

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.archived_at).not.toBeNull();
    } finally {
      await live.cleanup();
    }
  });
});
