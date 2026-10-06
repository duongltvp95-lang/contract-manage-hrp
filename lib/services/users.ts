import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CreateUserSchema,
  UpdateUserSchema,
  type UpdateUserInput,
  type UserRole,
} from "@schemas/user";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword } from "@/lib/temp-password";
import { recordAudit } from "@/lib/services/audit-logs";
import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * User management — feature round 2, part 3 + round 3, part 1.
 *
 * The only module allowed to use the service-role client, and every function
 * here starts by proving the caller is an administrator. Two rules hold
 * throughout:
 *
 *   1. `organizationId` comes from the session. A caller that passes a different
 *      one is refused rather than trusted.
 *   2. The app intentionally has no delete-user action. Provisioning and
 *      role/active state changes are the whole surface; removing access is
 *      an owner decision, executed out of band (Supabase Dashboard, service
 *      role). The round 3 part 1 update path lives below; the delete path
 *      is absent on purpose.
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
