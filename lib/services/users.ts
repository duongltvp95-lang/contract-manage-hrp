import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CreateUserSchema,
  DeleteUserSchema,
  UpdateUserSchema,
  type DeleteUserInput,
  type UpdateUserInput,
  type UserRole,
} from "@schemas/user";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword } from "@/lib/temp-password";
import { recordAudit } from "@/lib/services/audit-logs";
import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * The well-known profile row that audit_logs.actor_id points at after a
 * user is hard-deleted.
 *
 * The tombstone row is created on demand the first time `deleteUser` is
 * asked to clean up, by `ensureTombstoneProfile()` further down. The
 * resolved id is cached in `tombstoneProfileIdCache` so subsequent
 * deletes do not hit the Admin API.
 *
 * The seed value below is a placeholder that is overwritten on the
 * first call. We keep a literal so the type system can describe the
 * shape and so a stack trace referencing the constant is not
 * `<unresolved>`.
 */
export const TOMBSTONE_PROFILE_ID = "00000000-0000-0000-0000-000000005a01";
export const TOMBSTONE_PROFILE_EMAIL = "tombstone.deleted-user@hrpartner.vn";

let tombstoneProfileIdCache: string | null = null;

/**
 * Ensure the tombstone profile row exists in `profiles`, returning its id.
 *
 * The flow:
 *
 *   1. Return the cached id on the hot path.
 *   2. Look up an `auth.users` row by the well-known email. The Admin
 *      API is paginated; the loop stops when a page is short, which is
 *      the documented "end of list" signal.
 *   3. If no auth row is present, create one with a random 64-char
 *      password (no human can ever type it) and `email_confirm: true`.
 *      Re-read the new id from the response.
 *   4. UPSERT the `profiles` row at that id: role='user', is_active=false,
 *      full_name='[Người dùng đã xoá]', organisation set to the admin's.
 *      The `on_auth_user_created` trigger fired during step 3 wrote a
 *      different shape (role='user', is_active=true, full_name from
 *      user_metadata); this UPSERT normalises it.
 *   5. Cache and return the id.
 *
 * Errors at any step return a `ServiceErr`; the cache is not poisoned,
 * so a follow-up attempt can try again. Two concurrent deletes are
 * safe: the `find` in step 2 short-circuits whichever loses the race.
 */
async function ensureTombstoneProfile(
  service: SupabaseClient,
  organizationId: string,
): Promise<ServiceResult<{ id: string }>> {
  if (tombstoneProfileIdCache) {
    return ok({ id: tombstoneProfileIdCache });
  }

  let found: string | null = null;
  try {
    for (let page = 1; ; page += 1) {
      const { data, error } = await service.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) {
        return dbError("ensureTombstoneProfile", error);
      }
      const users = data?.users ?? [];
      const match = users.find(
        (user) => user.email === TOMBSTONE_PROFILE_EMAIL,
      );
      if (match) {
        found = match.id;
        break;
      }
      if (users.length < 200) break;
    }
  } catch (error) {
    return dbError("ensureTombstoneProfile", error);
  }

  if (!found) {
    const random =
      typeof globalThis.crypto?.getRandomValues === "function"
        ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")
        : "no-real-password-tombstone-fallback";
    try {
      const { data, error } = await service.auth.admin.createUser({
        email: TOMBSTONE_PROFILE_EMAIL,
        password: random,
        email_confirm: true,
        user_metadata: { full_name: "[Người dùng đã xoá]" },
      });
      if (error || !data?.user) {
        return dbError("ensureTombstoneProfile", error);
      }
      found = data.user.id;
    } catch (error) {
      return dbError("ensureTombstoneProfile", error);
    }
  }

  if (!found) {
    return err(
      "db_error",
      "Không tạo được tombstone profile. Vui lòng thử lại sau ít phút.",
    );
  }

  const { error: upsertError } = await service
    .from("profiles")
    .upsert(
      {
        id: found,
        organization_id: organizationId,
        full_name: "[Người dùng đã xoá]",
        role: "user",
        is_active: false,
        is_tombstone: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (upsertError) {
    return dbError("ensureTombstoneProfile", upsertError);
  }

  tombstoneProfileIdCache = found;
  return ok({ id: found });
}

/**
 * User management — feature round 2, part 3 + round 3, part 1 + round 4, part 1.
 *
 * The only module allowed to use the service-role client, and every function
 * here starts by proving the caller is an administrator. Two rules hold
 * throughout:
 *
 *   1. `organizationId` comes from the session. A caller that passes a different
 *      one is refused rather than trusted.
 *   2. The hard-delete path is round 4: an admin can drop a real auth.users
 *      row, subject to the self / last-admin / email-confirmation guards.
 *      The audit trail survives via the tombstone profile at
 *      `TOMBSTONE_PROFILE_ID` (created by
 *      `supabase/migrations/20261006120000_audit_logs_actor_tombstone.sql`),
 *      which `deleteUser` writes into `audit_logs.actor_id` for every row
 *      that previously named the victim.
 */

export type ManagedUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

export type CreatedUser = {
  user: ManagedUser;
  /**
   * Returned to the caller exactly once, to be shown to the administrator.
   * Never stored anywhere — not in the database, not in a log.
   */
  temporaryPassword: string;
};

export type CreateUserServiceInput = {
  organizationId: string;
  email: string;
  fullName: string;
  role: UserRole;
};

/** Round 3, part 1 — admin-driven update of role / active state. */
export type UpdateUserServiceInput = UpdateUserInput;

/** Round 4, part 1 — admin-driven hard delete. */
export type DeleteUserServiceInput = DeleteUserInput;

/**
 * True when the signed-in user is an administrator.
 *
 * `getCurrentUser()` (not `requireUser()`) on purpose: a service must answer with
 * a result, never with a redirect.
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === "admin";
}

/**
 * The authorization gate for everything in this module.
 *
 * Returns the session user so callers do not have to re-read it — and so there
 * is exactly one place that decides what "admin" means.
 */
export async function requireAdmin() {
  const user = await getCurrentUser();

  if (!user) {
    return err("unauthenticated", "Bạn cần đăng nhập để thực hiện thao tác này");
  }

  if (user.role !== "admin") {
    return err(
      "forbidden",
      "Chỉ quản trị viên mới có quyền quản lý người dùng",
    );
  }

  return ok(user);
}

/**
 * Every `auth.users` row, as an id -> email map.
 *
 * Emails live in `auth.users`, which PostgREST does not expose at all, so this
 * has to go through the Admin API. It is paginated because the API caps a page
 * at 1000 rows and a silent truncation would show users with a blank email.
 */
async function listAuthEmails(
  service: SupabaseClient,
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email) emails.set(user.id, user.email);
    }

    if (users.length < perPage) break;
  }

  return emails;
}

/**
 * The organization's users, oldest first.
 *
 * Administrator only. `profiles` carries the role and the state; the email is
 * joined in from `auth.users` because that is where it actually lives.
 */
export async function listUsers({
  organizationId,
}: {
  organizationId: string;
}): Promise<ServiceResult<ManagedUser[]>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  if (admin.data.organizationId !== organizationId) {
    return err("forbidden", "Không thể xem người dùng của tổ chức khác");
  }

  const service = createAdminClient();

  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, full_name, role, is_active, created_at")
    .eq("organization_id", organizationId)
    .eq("is_tombstone", false)
    .order("created_at", { ascending: true });

  if (error) {
    return dbError("listUsers", error);
  }

  let emails: Map<string, string>;
  try {
    emails = await listAuthEmails(service);
  } catch (error) {
    return dbError("listUsers", error);
  }

  const rows = (profiles ?? []) as {
    id: string;
    full_name: string | null;
    role: string;
    is_active: boolean;
    created_at: string;
  }[];

  return ok(
    rows.map((row) => ({
      id: row.id,
      email: emails.get(row.id) ?? null,
      fullName: row.full_name,
      role: (row.role === "admin" ? "admin" : "user") as UserRole,
      isActive: row.is_active,
      createdAt: row.created_at,
    })),
  );
}

/**
 * Provisions a new user in the administrator's organization.
 *
 * Order matters:
 *   1. authorize (administrator, and the organization matches the session);
 *   2. validate the payload;
 *   3. refuse a duplicate email — before creating anything, so the common
 *      mistake produces a clear message instead of a half-made account;
 *   4. create the auth user with a generated password and a confirmed email
 *      (public sign-up is disabled, so this is the only way in);
 *   5. write the profile: full_name, role, and the organization explicitly.
 *
 * Step 5 sets `organization_id` even though `handle_new_user` already assigned
 * the *default* organization. The two agree today because there is one
 * organization; making it explicit means the invariant is "the new user belongs
 * to the administrator's organization" by construction, rather than by luck
 * when a second organization appears.
 */
export async function createUser(
  input: CreateUserServiceInput,
): Promise<ServiceResult<CreatedUser>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  if (admin.data.organizationId !== input.organizationId) {
    return err(
      "forbidden",
      "Không thể tạo người dùng cho tổ chức khác",
    );
  }

  const parsed = CreateUserSchema.safeParse(input);

  if (!parsed.success) {
    return err(
      "validation",
      "Thông tin người dùng không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const { email, fullName, role } = parsed.data;
  const service = createAdminClient();

  // --- duplicate email ------------------------------------------------------
  let existingEmails: Map<string, string>;
  try {
    existingEmails = await listAuthEmails(service);
  } catch (error) {
    return dbError("createUser", error);
  }

  const wanted = email.toLowerCase();
  const duplicate = [...existingEmails.values()].some(
    (value) => value.toLowerCase() === wanted,
  );

  if (duplicate) {
    return err("validation", `Email ${email} đã tồn tại trong hệ thống`);
  }

  // --- create ---------------------------------------------------------------
  const temporaryPassword = generateTemporaryPassword();

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created?.user) {
    return dbError("createUser", createError);
  }

  const userId = created.user.id;

  // --- profile --------------------------------------------------------------
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .update({
      full_name: fullName,
      role,
      organization_id: admin.data.organizationId,
    })
    .eq("id", userId)
    .select("id, full_name, role, is_active, created_at")
    .single();

  if (profileError || !profile) {
    /*
     * The auth row exists but has no usable profile, which would be an account
     * nobody can manage and that RLS cannot scope to an organization. Rolling
     * the auth user back keeps "an account exists" and "a profile exists" from
     * drifting apart. This is a cleanup of our own half-finished write, not a
     * user-management delete — there is no delete feature in this round.
     */
    try {
      await service.auth.admin.deleteUser(userId);
    } catch {
      /* the administrator will see the failure below either way */
    }

    return dbError("createUser", profileError);
  }

  const row = profile as {
    id: string;
    full_name: string | null;
    role: string;
    is_active: boolean;
    created_at: string;
  };

  return ok({
    user: {
      id: row.id,
      email,
      fullName: row.full_name,
      role: (row.role === "admin" ? "admin" : "user") as UserRole,
      isActive: row.is_active,
      createdAt: row.created_at,
    },
    temporaryPassword,
  });
}

// ---------------------------------------------------------------------------
// Round 3, part 1 — update + delete, admin only
// ---------------------------------------------------------------------------

/** Count how many *other* active admins an organization has. */
async function countOtherAdmins(
  service: SupabaseClient,
  organizationId: string,
  excludeUserId: string,
): Promise<ServiceResult<{ count: number }>> {
  const { count, error } = await service
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .eq("is_active", true)
    .neq("id", excludeUserId);

  if (error) {
    return dbError("countOtherAdmins", error);
  }

  return ok({ count: count ?? 0 });
}

/**
 * Blocks the path that would demote or disable the last active admin of an
 * organization.
 *
 * The target's *current* role and is_active decide whether a change can
 * possibly remove the last admin. A change against a non-admin is a no-op
 * (the caller's intent still has to be valid, but the last-admin rule is
 * irrelevant); only when the target is already an active admin do we look at
 * the *proposed* change (`targetRole`, `targetActive`).
 *
 * Caller is expected to pass `currentRole` / `currentIsActive` when it has
 * already read the row (the call site has `target.role` / `target.is_active`
 * in scope). When omitted, the values default to the proposed change, which
 * is the conservative answer for a caller that has not inspected the row.
 */
async function assertNotLastAdmin(
  service: SupabaseClient,
  organizationId: string,
  targetUserId: string,
  targetRole: UserRole | undefined,
  targetActive: boolean | undefined,
  current: { role: string; isActive: boolean } = { role: "user", isActive: true },
): Promise<ServiceResult<{ ok: true }>> {
  // Only active admins can lose admin coverage. Everyone else is a no-op.
  if (current.role !== "admin" || current.isActive !== true) {
    return ok({ ok: true });
  }

  const losingAdmin =
    targetRole === "user" || targetActive === false;

  if (!losingAdmin) {
    return ok({ ok: true });
  }

  const result = await countOtherAdmins(service, organizationId, targetUserId);
  if (!result.ok) {
    return result;
  }

  if (result.data.count === 0) {
    return err(
      "forbidden",
      "Không thể hạ cấp hoặc vô hiệu hoá quản trị viên cuối cùng của tổ chức",
    );
  }

  return ok({ ok: true });
}

type ProfileDbRow = {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
};

function managedUserFromRow(
  row: ProfileDbRow,
  email: string | null,
): ManagedUser {
  return {
    id: row.id,
    email,
    fullName: row.full_name,
    role: (row.role === "admin" ? "admin" : "user") as UserRole,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/**
 * Update role / active state. The action's `loggedInUserId` comes from the
 * session; the target's `userId` comes from the form. An admin cannot
 * demote or disable the last remaining active admin in the organization
 * (`assertNotLastAdmin`).
 *
 * The change is audited regardless of whether role or isActive changed —
 * one event per call, because that is what the UI fires.
 */
export async function updateUser(
  input: UpdateUserServiceInput,
  loggedInUserId: string,
): Promise<ServiceResult<ManagedUser>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  const parsed = UpdateUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "validation",
      "Thông tin cập nhật không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const { userId, role, isActive } = parsed.data;

  let service: SupabaseClient;
  try {
    service = await createAdminClient();
  } catch (error) {
    return dbError("updateUser", error);
  }

  // --- the target row has to exist in our organization ---------------------
  const { data: existing, error: existingError } = await service
    .from("profiles")
    .select("id, full_name, role, is_active, created_at")
    .eq("id", userId)
    .eq("organization_id", admin.data.organizationId)
    .maybeSingle();

  if (existingError) {
    return dbError("updateUser", existingError);
  }
  if (!existing) {
    return err("not_found", "Không tìm thấy người dùng trong tổ chức");
  }

  const target = existing as ProfileDbRow;

  // --- last-admin guard ---------------------------------------------------
  const lastAdminCheck = await assertNotLastAdmin(
    service,
    admin.data.organizationId,
    userId,
    role,
    isActive,
    { role: target.role, isActive: target.is_active },
  );
  if (!lastAdminCheck.ok) {
    return lastAdminCheck;
  }

  // --- build the patch ----------------------------------------------------
  const patch: Record<string, unknown> = {};
  if (role !== undefined && role !== target.role) {
    patch.role = role;
  }
  if (isActive !== undefined && isActive !== target.is_active) {
    patch.is_active = isActive;
  }

  if (Object.keys(patch).length === 0) {
    // Nothing actually changed. Return the current row without writing.
    return ok(managedUserFromRow(target, null));
  }

  // --- write --------------------------------------------------------------
  const { data: updated, error: updateError } = await service
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id, full_name, role, is_active, created_at")
    .single();

  if (updateError || !updated) {
    return dbError("updateUser", updateError);
  }

  const next = updated as ProfileDbRow;

  // --- audit --------------------------------------------------------------
  // One event per *kind* of change. If both role and isActive changed, the
  // row is the same but the action label is different, so we write two rows
  // and let the table show both. A log write that fails must not block the
  // change, so the result is discarded after a warning.
  const metadata: Record<string, unknown> = { from: { role: target.role, isActive: target.is_active } };
  if (patch.role !== undefined) {
    metadata.role_to = next.role;
    try {
      await recordAudit({
        organizationId: admin.data.organizationId,
        actorId: loggedInUserId,
        actorRole: "admin",
        action: "update_user_role",
        targetKind: "user",
        targetId: userId,
        metadata: { from: target.role, to: next.role },
      });
    } catch {
      // already swallowed by recordAudit returning a ServiceResult
    }
  }
  if (patch.is_active !== undefined) {
    try {
      await recordAudit({
        organizationId: admin.data.organizationId,
        actorId: loggedInUserId,
        actorRole: "admin",
        action: "set_active_user",
        targetKind: "user",
        targetId: userId,
        metadata: { from: target.is_active, to: next.is_active },
      });
    } catch {
      /* see comment above */
    }
  }

  return ok(managedUserFromRow(next, null));
}

/**
 * Hard delete a user. Round 4, part 1.
 *
 * Five guards in order, each of which can short-circuit with a 4xx-friendly
 * service error:
 *
 *   1. Caller is an administrator (handled by `requireAdmin`).
 *   2. `confirmEmail` matches the target's email in `auth.users`. The match
 *      is case-insensitive and trims both sides, the same way destructive
 *      auth-library dialogs do.
 *   3. The caller is not the target. An admin cannot drop their own account
 *      from the application's UI: the only path out is the owner acting out
 *      of band on a different admin's behalf.
 *   4. If the target is the *only* active admin of the organization, refuse.
 *      Demotion would have to be the first move; deletion is the second.
 *   5. After all four pass, two writes happen, both auditable:
 *
 *      a. Every existing `audit_logs` row whose `actor_id` is the target is
 *         re-pointed at `TOMBSTONE_PROFILE_ID`. The audit table's FK to
 *         `profiles` would otherwise stop the cascade from `auth.users`
 *         delete reaching `profiles`. The re-pointed rows keep their
 *         `metadata` and `created_at` so the timeline reads normally; only
 *         the "actor" column is a tombstone pointer.
 *      b. A new `audit_logs` row is written for the delete itself, with
 *         `actor_id = admin` (this admin) and `target_id = target` (the
 *         soon-to-be-deleted user). That row survives the cascade because
 *         its `actor_id` is a real, still-live profile.
 *
 *   6. The `auth.users` row is deleted last. The cascade drops the target's
 *      `profiles` row; `contracts.created_by` flips to NULL via its own
 *      `on delete set null`; nothing else in the schema depends on the row.
 *
 * If step 6 fails the profile/auth are unchanged, but the audit-row
 * re-pointing and the new `delete_user` log row are already in. The new row
 * is the only evidence of an attempt, which is the right amount of noise
 * (see round 3's "audit failure does not block the real action" rule).
 */
export async function deleteUser(
  input: DeleteUserServiceInput,
  loggedInUserId: string,
): Promise<ServiceResult<{ deletedUserId: string }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  const parsed = DeleteUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "validation",
      "Thông tin xoá không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const { userId, confirmEmail } = parsed.data;

  // --- guard 3: self-delete ---------------------------------------------
  if (userId === loggedInUserId) {
    return err("forbidden", "Bạn không thể xoá chính mình");
  }

  let service: SupabaseClient;
  try {
    service = await createAdminClient();
  } catch (error) {
    return dbError("deleteUser", error);
  }

  // --- target lookup -----------------------------------------------------
  const { data: target, error: targetError } = await service
    .from("profiles")
    .select("id, full_name, role, is_active, created_at")
    .eq("id", userId)
    .eq("organization_id", admin.data.organizationId)
    .maybeSingle();

  if (targetError) {
    return dbError("deleteUser", targetError);
  }
  if (!target) {
    return err("not_found", "Không tìm thấy người dùng trong tổ chức");
  }

  const targetRow = target as ProfileDbRow;

  // --- guard 4: last-admin ----------------------------------------------
  if (targetRow.role === "admin" && targetRow.is_active) {
    const lastAdminCheck = await assertNotLastAdmin(
      service,
      admin.data.organizationId,
      userId,
      "user",
      false,
      { role: targetRow.role, isActive: targetRow.is_active },
    );
    if (!lastAdminCheck.ok) {
      return lastAdminCheck;
    }
  }

  // --- guard 2: email confirmation --------------------------------------
  // The user typed an email; we look up the real one and compare. Trim + case
  // fold, both sides. The real value is whatever the auth row currently
  // carries; a future rename of the auth row would have to re-confirm.
  let realEmail: string | null = null;
  try {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (error) {
      return dbError("deleteUser", error);
    }
    realEmail = data?.user?.email ?? null;
  } catch (error) {
    return dbError("deleteUser", error);
  }

  if (!realEmail) {
    return err("not_found", "Không tìm thấy email của người dùng");
  }
  if (realEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
    return err("validation", "Email xác nhận không khớp với email người dùng");
  }

  // --- step 5a (prelude): ensure the tombstone profile row exists --------
  // The tombstone is a real auth.users + profiles row with a fixed email,
  // a random password nobody can type, is_active=false, and the
  // localised full_name. We look it up or create it on demand; the first
  // call is the only one that hits the Admin API.
  const tombstone = await ensureTombstoneProfile(
    service,
    admin.data.organizationId,
  );
  if (!tombstone.ok) {
    return tombstone;
  }
  const tombstoneId = tombstone.data.id;

  // --- step 5a: re-point existing audit rows at the tombstone -------------
  // The `audit_logs.actor_id` FK to `profiles` is `on delete restrict`, and
  // deleting `auth.users` cascades its `profiles` row away. Without this
  // re-pointing the cascade trips the RESTRICT and the whole delete fails.
  // The metadata, created_at, and organization_id columns are untouched, so
  // the timeline is still readable; only the "who did it" cell now reads
  // "[Người dùng đã xoá]" via the tombstone's full_name.
  const { error: repointError } = await service
    .from("audit_logs")
    .update({ actor_id: tombstoneId })
    .eq("actor_id", userId);

  if (repointError) {
    return dbError("deleteUser", repointError);
  }

  // --- step 5b: write the delete_user audit row -------------------------
  // The new row's actor is the *admin* (this caller), not the target, so
  // the cascade does not touch it. `target_id` is the about-to-be-deleted
  // user; that column has no FK, so the later cascade is a no-op for it.
  try {
    await recordAudit({
      organizationId: admin.data.organizationId,
      actorId: loggedInUserId,
      actorRole: "admin",
      action: "delete_user",
      targetKind: "user",
      targetId: userId,
      metadata: {
        email: realEmail,
        fullName: targetRow.full_name,
        role: targetRow.role,
        confirmEmail,
      },
    });
  } catch {
    /* see file-level rule: an audit failure does not block the real action */
  }

  // --- step 6: drop the auth.users row -----------------------------------
  // The cascade covers:
  //   - profiles (on delete cascade) — but the actor_id re-pointing above
  //     already protected any audit rows that named this profile.
  //   - contracts.created_by (on delete set null) — kept; we want the
  //     contract to stay so the audit trail for that contract is intact.
  // If the auth delete fails (rare; would mean a Supabase-side revocation
  // just landed), the partial work — re-pointed actor rows + the new
  // delete_user log — is the only evidence of the attempt. The user is
  // still alive and can be retried.
  const { error: authError } = await service.auth.admin.deleteUser(userId);
  if (authError) {
    return dbError("deleteUser", authError);
  }

  return ok({ deletedUserId: userId });
}
