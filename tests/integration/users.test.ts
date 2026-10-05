import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasLiveBackend } from "../setup/env";
import { BASE_URL, ORG_A, TEST_PREFIX } from "./config";
import {
  adminClient,
  createSecondTenant,
  destroySecondTenant,
  signInAs,
  signInAsAdmin,
  sweepTestRows,
  type TestSession,
} from "./helpers";

/**
 * Feature round 2, part 3 — user management.
 *
 * The admin path is exercised through the real service (via the test-only probe
 * route, because the service reads the session from cookies and is normally
 * called as a server action). The non-admin paths are the point of the suite:
 * every entry point must refuse a caller who is not an administrator, and the
 * refusal has to come from the SERVICE, not from a hidden button.
 *
 * The temporary-password requirement is verified the only way that proves
 * anything: signing in with it.
 */

const suite = hasLiveBackend ? describe : describe.skip;

async function probe(
  action: "list" | "create",
  payload: Record<string, unknown>,
  cookie: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}/api/users-probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action, ...payload }),
  });

  return { status: response.status, body: await response.json().catch(() => null) };
}

suite("user management — administrators only (feature round 2)", () => {
  let admin: SupabaseClient;
  let orgA: TestSession;
  let orgB: TestSession;

  const createdUserIds: string[] = [];
  const stamp = Date.now().toString(36);

  beforeAll(async () => {
    admin = adminClient();
    await sweepTestRows(admin);

    orgA = await signInAsAdmin();
    orgB = await createSecondTenant(admin, "users");
  }, 180_000);

  afterAll(async () => {
    // Remove the accounts this suite created. This is test cleanup through the
    // service role — there is no delete-user feature in the product.
    for (const id of createdUserIds) {
      await admin.from("profiles").delete().eq("id", id);
      await admin.auth.admin.deleteUser(id);
    }

    if (orgB) await destroySecondTenant(admin, orgB);
    if (admin) await sweepTestRows(admin);
  }, 180_000);

  it("an administrator sees the organization's users, with emails", async () => {
    const result = await probe("list", {}, orgA.cookie);

    expect(result.status).toBe(200);

    const rows = result.body as { email: string | null; role: string }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((row) => row.email === orgA.email)).toBe(true);
    // Emails come from auth.users, which PostgREST does not expose: a blank
    // email here would mean the Admin API join silently failed.
    expect(rows.every((row) => typeof row.email === "string" && row.email.length > 0)).toBe(
      true,
    );
  });

  it("a non-administrator cannot list users", async () => {
    const result = await probe("list", {}, orgB.cookie);

    expect(result.status).toBe(403);
    expect((result.body as { code?: string })?.code).toBe("forbidden");
  });

  it("a non-administrator cannot create a user", async () => {
    const email = `w1test.notadmin.${stamp}@hrpartner.test`;
    const result = await probe(
      "create",
      { email, fullName: "Không phải admin", role: "user" },
      orgB.cookie,
    );

    expect(result.status).toBe(403);
    expect((result.body as { code?: string })?.code).toBe("forbidden");

    // And nothing was created behind the refusal.
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    expect(users?.users?.some((user) => user.email === email)).toBe(false);
  });

  it("an anonymous caller cannot create a user", async () => {
    const result = await probe(
      "create",
      { email: `w1test.anon.${stamp}@hrpartner.test`, fullName: "Ẩn danh", role: "user" },
      "",
    );

    expect(result.status).toBe(401);
  });

  it("an administrator creates a user who can sign in with the temporary password", async () => {
    const email = `w1test.created.${stamp}@hrpartner.test`;
    const fullName = `${TEST_PREFIX}Người dùng mới`;

    const result = await probe(
      "create",
      { email, fullName, role: "user" },
      orgA.cookie,
    );

    expect(result.status).toBe(200);

    const created = result.body as {
      user: { id: string; email: string; fullName: string; role: string; isActive: boolean };
      temporaryPassword: string;
    };

    createdUserIds.push(created.user.id);

    expect(created.user.email).toBe(email);
    expect(created.user.role).toBe("user");
    expect(created.user.isActive).toBe(true);
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(12);

    // The auth row exists…
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const authUser = users?.users?.find((user) => user.email === email);
    expect(authUser?.id).toBe(created.user.id);
    // …with the email already confirmed, because public sign-up is disabled.
    expect(authUser?.email_confirmed_at).toBeTruthy();

    // …and the profile carries the organization and the role the service wrote.
    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id, full_name, role, is_active")
      .eq("id", created.user.id)
      .single();

    expect(profile?.organization_id).toBe(ORG_A);
    expect(profile?.full_name).toBe(fullName);
    expect(profile?.role).toBe("user");
    expect(profile?.is_active).toBe(true);

    // The password really works — the whole point of returning it.
    const session = await signInAs(email, created.temporaryPassword);
    expect(session.userId).toBe(created.user.id);
  }, 120_000);

  it("an administrator can create another administrator", async () => {
    const email = `w1test.newadmin.${stamp}@hrpartner.test`;

    const result = await probe(
      "create",
      { email, fullName: `${TEST_PREFIX}Quản trị mới`, role: "admin" },
      orgA.cookie,
    );

    expect(result.status).toBe(200);

    const created = result.body as {
      user: { id: string; role: string };
      temporaryPassword: string;
    };
    createdUserIds.push(created.user.id);

    expect(created.user.role).toBe("admin");

    // The role is real, not cosmetic: the new account signs in and can itself
    // list the organization's users.
    const newAdmin = await signInAs(email, created.temporaryPassword);
    const list = await probe("list", {}, newAdmin.cookie);

    expect(list.status).toBe(200);
  }, 120_000);

  it("refuses a duplicate email", async () => {
    const email = `w1test.duplicate.${stamp}@hrpartner.test`;

    const first = await probe(
      "create",
      { email, fullName: `${TEST_PREFIX}Trùng email`, role: "user" },
      orgA.cookie,
    );
    expect(first.status).toBe(200);
    createdUserIds.push((first.body as { user: { id: string } }).user.id);

    const second = await probe(
      "create",
      { email, fullName: `${TEST_PREFIX}Trùng email lần hai`, role: "user" },
      orgA.cookie,
    );

    expect(second.status).toBe(422);
    expect(String((second.body as { error?: string })?.error)).toContain("đã tồn tại");
  }, 120_000);

  it("refuses an invalid payload", async () => {
    const result = await probe(
      "create",
      { email: "không-phải-email", fullName: "", role: "user" },
      orgA.cookie,
    );

    expect(result.status).toBe(422);
    expect((result.body as { code?: string })?.code).toBe("validation");
  });
});
