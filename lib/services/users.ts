import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CreateUserSchema, type UserRole } from "@schemas/user";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword } from "@/lib/temp-password";
import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * User management — feature round 2, part 3.
 *
 * The only module allowed to use the service-role client, and every function
 * here starts by proving the caller is an administrator. Two rules hold
 * throughout:
 *
 *   1. `organizationId` comes from the session. A caller that passes a different
 *      one is refused rather than trusted.
 *   2. There is no delete and no deactivate. Provisioning is the whole feature
 *      this round; removing access is an owner decision for later.
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
