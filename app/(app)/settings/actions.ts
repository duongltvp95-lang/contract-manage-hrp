"use server";

import { updateProfile, type ProfileSummary } from "@/lib/services/profiles";
import { createUser, type CreatedUser } from "@/lib/services/users";
import { authorized, fromService, type ActionResult } from "@/lib/server-action";

/**
 * Settings server actions — plan section 71.
 *
 * The user id comes from the session; the form only ever supplies `fullName`.
 *
 * `createUserAction` (feature round 2, part 3) forwards to a service that
 * re-checks the administrator role itself and takes the organization from the
 * session — the action is a thin boundary, not the guard. There is deliberately
 * no action to delete or deactivate a user.
 */

export async function updateProfileAction(
  input: unknown,
): Promise<ActionResult<ProfileSummary>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const result = await updateProfile(input, access.user.id);

  return fromService(result);
}

export async function createUserAction(
  input: unknown,
): Promise<ActionResult<CreatedUser>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const payload = (input ?? {}) as Record<string, unknown>;

  const result = await createUser({
    // From the session. A value in `payload.organizationId` is ignored.
    organizationId: access.user.organizationId,
    email: String(payload.email ?? ""),
    fullName: String(payload.fullName ?? ""),
    role: payload.role === "admin" ? "admin" : "user",
  });

  return fromService(result);
}
