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
 * Round 9, part 2 — `createUser` now writes a `create_user` audit row.
 *
 * Round 3 declared the action in the enum but never recorded it. This test
 * exercises the real `createUser` service through the users-actions probe and
 * asserts the row carries the right actor, target and metadata.
 */

const suite = hasLiveBackend ? describe : describe.skip;

suite("audit — create_user (round 9)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let startedAt: string;
  let createdUserId: string | null = null;

  const stamp = Date.now().toString(36);
  const email = `e2e.audit.createuser.${stamp}@hrpartner.test`;
  const fullName = `${TEST_PREFIX}Người dùng create_user ${stamp}`;

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    startedAt = new Date().toISOString();
    orgA = await signInAsAdmin();
  }, 180_000);

  afterAll(async () => {
    // The audit row names the created user only as TARGET (no FK); the profile
    // cascades from the auth-user delete, so this is enough to clean up.
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId);
    }
    if (admin && startedAt) {
      await admin.from("audit_logs").delete().gte("created_at", startedAt);
    }
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("writes one create_user row with actor, target and metadata", async () => {
    const response = await fetch(`${BASE_URL}/api/users-actions-probe`, {
      method: "POST",
      headers: { cookie: orgA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "create", email, fullName, role: "user" }),
    });

    expect(response.status).toBe(200);
    const created = (await response.json()) as {
      user?: { id: string };
      temporaryPassword?: string;
    };
    expect(created.user?.id).toBeTruthy();
    createdUserId = created.user!.id;

    const { data } = await admin
      .from("audit_logs")
      .select("actor_id, action, target_kind, target_id, metadata")
      .eq("action", "create_user")
      .eq("target_id", createdUserId)
      .single();

    expect(data).toBeTruthy();
    if (!data) return;

    expect(data).toMatchObject({
      actor_id: orgA.userId,
      action: "create_user",
      target_kind: "user",
      target_id: createdUserId,
    });
    expect(data.metadata).toMatchObject({ email, fullName, role: "user" });
  }, 120_000);
});
