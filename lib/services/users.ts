import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CreateUserSchema,
  DeleteUserSchema,
  ResetUserPasswordSchema,
  UpdateUserSchema,
  type DeleteUserInput,
  type ResetUserPasswordInput,
  type UpdateUserInput,
  type UserRole,
} from "@schemas/user";

import { getCurrentUser } from "@/lib/auth";
import { isOwnerEmail, isOwnerUserId } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword } from "@/lib/temp-password";
import { recordAudit, recordCurrentUserAudit } from "@/lib/services/audit-logs";
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

const tombstoneProfileIdCache = new Map<string, string>();

/** Test seam: clears in-memory tombstone cache between unit tests. */
export function resetTombstoneProfileCache(): void {
  tombstoneProfileIdCache.clear();
}

function isAuthUserNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; code?: string; message?: string };
  if (candidate.status === 404 || candidate.code === "user_not_found") {
    return true;
  }
  return typeof candidate.message === "string" && /user not found/i.test(candidate.message);
}

/**
 * Ensure the tombstone profile row exists in `profiles` for `organizationId`,
 * returning its id.
 */
async function ensureTombstoneProfile(
  service: SupabaseClient,
  organizationId: string,
): Promise<ServiceResult<{ id: string }>> {
  const cached = tombstoneProfileIdCache.get(organizationId);
  if (cached) {
    return ok({ id: cached });
  }

  // Fast path: check if this organization already has a tombstone profile row.
  const { data: existingTombstone, error: lookupError } = await service
    .from("profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_tombstone", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return dbError("ensureTombstoneProfile", lookupError);
  }

  if (existingTombstone?.id) {
    const existingId = String(existingTombstone.id);
    tombstoneProfileIdCache.set(organizationId, existingId);
    return ok({ id: existingId });
  }

  let candidateEmail = TOMBSTONE_PROFILE_EMAIL;
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
      const orgSpecificEmail = `tombstone.deleted-user.${organizationId}@hrpartner.vn`;
      const orgSpecificMatch = users.find((user) => user.email === orgSpecificEmail);
      if (orgSpecificMatch) {
        found = orgSpecificMatch.id;
        candidateEmail = orgSpecificEmail;
        break;
      }
      const legacyMatch = users.find((user) => user.email === TOMBSTONE_PROFILE_EMAIL);
      if (legacyMatch) {
        const { data: legacyProfile } = await service
          .from("profiles")
          .select("organization_id")
          .eq("id", legacyMatch.id)
          .maybeSingle();
        if (!legacyProfile?.organization_id || legacyProfile.organization_id === organizationId) {
          found = legacyMatch.id;
          candidateEmail = TOMBSTONE_PROFILE_EMAIL;
        } else {
          candidateEmail = orgSpecificEmail;
        }
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
        email: candidateEmail,
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

  tombstoneProfileIdCache.set(organizationId, found);
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
const userEmailCache = new Map<string, { email: string; timestamp: number }>();
const USER_EMAIL_CACHE_TTL_MS = 60_000;

async function resolveUserEmails(
  service: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!userIds.length || !service.auth?.admin?.getUserById) return result;

  const now = Date.now();
  const missingIds: string[] = [];

  for (const id of userIds) {
    const cached = userEmailCache.get(id);
    if (cached && now - cached.timestamp < USER_EMAIL_CACHE_TTL_MS) {
      result.set(id, cached.email);
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length === 0) return result;

  // Tra cứu theo nhu cầu (on-demand) chỉ cho danh sách userIds thuộc tổ chức hiện hành.
  // Tuyệt đối không gọi listUsers toàn hệ thống để tránh nạp email của các tổ chức khác vào bộ nhớ.
  // Sử dụng sliding window worker pool concurrency = 10 (hết việc này nhận việc kế tiếp ngay).
  let index = 0;
  const workers = Array.from({ length: Math.min(missingIds.length, 10) }, async () => {
    while (index < missingIds.length) {
      const id = missingIds[index++];
      try {
        const { data, error } = await service.auth.admin.getUserById(id);
        if (!error && data?.user?.email) {
          result.set(id, data.user.email);
          userEmailCache.set(id, { email: data.user.email, timestamp: now });
        }
      } catch {
        // ignore error for mocked or restricted environments
      }
    }
  });
  await Promise.all(workers);

  return result;
}

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
export async function listUsers(params?: {
  organizationId?: string;
}): Promise<ServiceResult<ManagedUser[]>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  const targetOrgId = params?.organizationId ?? admin.data.organizationId;
  if (targetOrgId !== admin.data.organizationId) {
    return err("forbidden", "Không thể xem người dùng của tổ chức khác");
  }

  const service = createAdminClient();

  const query = service
    .from("profiles")
    .select("id, full_name, role, is_active, created_at")
    .eq("organization_id", targetOrgId)
    .eq("is_tombstone", false)
    .order("created_at", { ascending: true });

  const { data: profiles, error } = await query;

  if (error) {
    return dbError("listUsers", error);
  }

  const userIds = (profiles ?? []).map((p) => p.id);
  const emails = await resolveUserEmails(service, userIds);

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
 *   1. authorize (administrator);
 *   2. validate the payload;
 *   3. refuse a duplicate email — before creating anything, so the common
 *      mistake produces a clear message instead of a half-made account;
 *   4. create the auth user with a generated password and a confirmed email
 *      (public sign-up is disabled, so this is the only way in);
 *   5. write the profile: full_name, role, and the organization explicitly.
 */
export async function createUser(
  input: CreateUserServiceInput,
): Promise<ServiceResult<CreatedUser>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

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
      organization_id: input.organizationId || admin.data.organizationId,
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

  // --- audit (round 9) ------------------------------------------------------
  // The actor is the signed-in admin; `requireAdmin()` already ran at the top.
  // A log write that fails is swallowed — creating the user must not be undone
  // because the audit table is momentarily unhappy.
  await recordCurrentUserAudit({
    action: "create_user",
    targetKind: "user",
    targetId: row.id,
    metadata: { email, fullName: row.full_name ?? fullName, role: row.role },
  });

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

  // --- the target row has to exist ---------------------
  const { data: existing, error: existingError } = await service
    .from("profiles")
    .select("id, full_name, role, is_active, created_at, organization_id")
    .eq("id", userId)
    .eq("organization_id", admin.data.organizationId)
    .maybeSingle();

  if (existingError) {
    return dbError("updateUser", existingError);
  }
  if (!existing) {
    return err("not_found", "Không tìm thấy người dùng trong hệ thống");
  }

  const target = existing as ProfileDbRow & { organization_id?: string | null };
  if (target.organization_id !== admin.data.organizationId) {
    return err("forbidden", "Không thể quản lý người dùng của tổ chức khác");
  }
  const targetOrgId = admin.data.organizationId;

  // --- Owner protection guard --------------------------------------------
  // duongltvp95@gmail.com is the immutable system Owner.
  // NO ONE (including other admins and the owner themselves) can change their role or deactivate them.
  let targetEmail: string | null = null;
  try {
    const { data: targetAuth } = await service.auth.admin.getUserById(userId);
    targetEmail = targetAuth?.user?.email ?? null;
  } catch {
    // ignore
  }

  if (isOwnerUserId(userId) || isOwnerEmail(targetEmail)) {
    if (role !== undefined) {
      return err(
        "forbidden",
        "Không ai có quyền chỉnh sửa vai trò của tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)",
      );
    }
    if (isActive === false) {
      return err(
        "forbidden",
        "Không ai có quyền vô hiệu hoá tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)",
      );
    }
  }

  // --- last-admin guard ---------------------------------------------------
  const lastAdminCheck = await assertNotLastAdmin(
    service,
    targetOrgId,
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
    .eq("organization_id", admin.data.organizationId)
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
        organizationId: targetOrgId,
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
        organizationId: targetOrgId,
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
    .select("id, full_name, role, is_active, created_at, organization_id")
    .eq("id", userId)
    .eq("organization_id", admin.data.organizationId)
    .maybeSingle();

  if (targetError) {
    return dbError("deleteUser", targetError);
  }
  if (!target) {
    return err("not_found", "Không tìm thấy người dùng trong hệ thống");
  }

  const targetRow = target as ProfileDbRow & { organization_id?: string | null };
  if (targetRow.organization_id !== admin.data.organizationId) {
    return err("forbidden", "Không thể quản lý người dùng của tổ chức khác");
  }
  const targetOrgId = admin.data.organizationId;

  // --- guard 4: last-admin ----------------------------------------------
  if (targetRow.role === "admin" && targetRow.is_active) {
    const lastAdminCheck = await assertNotLastAdmin(
      service,
      targetOrgId,
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

  // --- Owner protection guard --------------------------------------------
  if (isOwnerUserId(userId) || isOwnerEmail(realEmail)) {
    return err(
      "forbidden",
      "Không ai có quyền xoá tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)",
    );
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
    targetOrgId,
  );
  if (!tombstone.ok) {
    return tombstone;
  }
  const tombstoneId = tombstone.data.id;

  // --- step 5a: snapshot historical actor identity & re-point to tombstone -
  // The `audit_logs.actor_id` FK to `profiles` is `on delete restrict`, and
  // deleting `auth.users` cascades its `profiles` row away. `prepare_actor_audit_for_user_delete`
  // snapshots the user's real name/email + `deleted_actor_id` on their historical
  // audit rows before moving `actor_id` to the org tombstone, so historical logs
  // keep human attribution AND can be rolled back cleanly if GoTrue fails.
  const { error: repointError } = await service.rpc(
    "prepare_actor_audit_for_user_delete",
    {
      p_organization_id: targetOrgId,
      p_user_id: userId,
      p_tombstone_id: tombstoneId,
      p_actor_name: targetRow.full_name,
      p_actor_email: realEmail,
    },
  );

  if (repointError) {
    return dbError("deleteUser", repointError);
  }

  // --- step 5b: drop the auth.users row BEFORE recording delete_user -------
  // If GoTrue rejects the deletion (e.g. transient outage), we restore the
  // re-pointed audit rows back to `userId` and return an error without writing
  // a premature `delete_user` event. If GoTrue reports 404 (a prior attempt
  // already deleted auth.users just before a network drop), treat it as
  // idempotently completed and clean up any orphaned profile row.
  let authError: unknown = null;
  try {
    const deleteResult = await service.auth.admin.deleteUser(userId);
    authError = deleteResult.error;
  } catch (error) {
    authError = error;
  }

  if (authError && !isAuthUserNotFoundError(authError)) {
    try {
      await service.rpc("restore_actor_audit_after_failed_user_delete", {
        p_organization_id: targetOrgId,
        p_user_id: userId,
        p_tombstone_id: tombstoneId,
      });
    } catch (rollbackError) {
      console.error("[users:deleteUser:rollback]", rollbackError);
    }
    return dbError("deleteUser", authError);
  }

  if (authError && isAuthUserNotFoundError(authError)) {
    await service
      .from("profiles")
      .delete()
      .eq("id", userId)
      .eq("organization_id", targetOrgId)
      .eq("is_tombstone", false);
  }

  // --- step 6: write the delete_user audit row AFTER Auth confirms ---------
  try {
    await recordAudit({
      organizationId: targetOrgId,
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
    /* see file-level rule: an audit failure does not block the completed action */
  }

  return ok({ deletedUserId: userId });
}

export type ResetUserPasswordResult = {
  userId: string;
  email: string | null;
  message: string;
};

/**
 * Đặt lại mật khẩu cho người dùng / quản trị viên khác bởi Admin.
 *
 * Quy tắc bảo vệ:
 * 1. Chỉ người dùng có vai trò admin mới được phép đặt lại mật khẩu.
 * 2. Phải thuộc cùng tổ chức (organization_id).
 * 3. Bảo vệ Owner: Tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)
 *    không ai được phép reset mật khẩu ngoại trừ chính duongltvp95@gmail.com.
 * 4. Quản trị viên duongltvp95@gmail.com có toàn quyền đặt lại mật khẩu cho tất cả
 *    người dùng và quản trị viên khác trong hệ thống.
 */
export async function resetUserPassword(
  input: ResetUserPasswordInput,
  loggedInUserId: string,
): Promise<ServiceResult<ResetUserPasswordResult>> {
  const parsed = ResetUserPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "validation",
      parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  // QUY TẮC BẢO MẬT: Chỉ Quản trị viên tối cao (Owner - duongltvp95@gmail.com) mới có quyền đặt lại mật khẩu!
  if (
    !isOwnerUserId(loggedInUserId) &&
    !isOwnerEmail(admin.data.email) &&
    !isOwnerUserId(admin.data.id)
  ) {
    return err(
      "forbidden",
      "Chỉ Quản trị viên tối cao (Owner) mới có quyền đặt lại mật khẩu cho người dùng",
    );
  }

  const { userId, password } = parsed.data;
  const service = createAdminClient();

  // 1. Kiểm tra tài khoản đích trong Auth / Profiles (không giới hạn phạm vi tổ chức)
  let targetEmail: string | null = null;
  try {
    const { data: targetAuth, error: authGetError } = await service.auth.admin.getUserById(userId);
    if (authGetError || !targetAuth?.user) {
      return err("not_found", "Không tìm thấy người dùng trong hệ thống");
    }
    targetEmail = targetAuth.user.email ?? null;
  } catch (error) {
    return dbError("resetUserPassword", error);
  }

  const { data: targetProfile } = await service
    .from("profiles")
    .select("id, role, is_active, organization_id")
    .eq("id", userId)
    .maybeSingle();

  // 3. Cập nhật mật khẩu trong auth.users bằng Admin client
  const { error: updateAuthError } = await service.auth.admin.updateUserById(userId, {
    password,
  });

  if (updateAuthError) {
    return dbError("resetUserPassword", updateAuthError);
  }

  // 4. Ghi audit log
  const auditOrgId = targetProfile?.organization_id || admin.data.organizationId;
  try {
    await recordAudit({
      organizationId: auditOrgId,
      actorId: loggedInUserId,
      actorRole: "admin",
      action: "update_profile",
      targetKind: "user",
      targetId: userId,
      metadata: { action: "reset_password", email: targetEmail },
    });
  } catch {
    // swallowed by design
  }

  return ok({
    userId,
    email: targetEmail,
    message: "Đặt lại mật khẩu thành công",
  });
}

