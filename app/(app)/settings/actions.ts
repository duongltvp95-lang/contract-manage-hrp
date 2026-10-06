"use server";

import {
  createUser,
  updateUser,
  type CreatedUser,
  type ManagedUser,
} from "@/lib/services/users";
import { updateProfile, type ProfileSummary } from "@/lib/services/profiles";
import { authorized, fromService, type ActionResult } from "@/lib/server-action";

/**
 * Settings server actions — plan section 71.
 *
 * The user id comes from the session; the form only ever supplies `fullName`.
 *
 * `createUserAction` (feature round 2, part 3) forwards to a service that
 * re-checks the administrator role itself and takes the organization from the
 * session — the action is a thin boundary, not the guard.
 *
 * Round 3, part 1 adds the matching update action. The service is the only
 * place that decides the action is allowed, and the action's job is to lift
 * the session and the form payload into the call.
 *
 * The app intentionally has no delete-user action; this file does not export
 * a `deleteUserAction` on purpose.
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

/**
 * Round 3, part 1 — change a user's role and/or active state.
 *
 * The service is the gate: it re-reads the session, re-checks the admin role,
 * enforces the same-organization rule, and refuses to demote or disable the
 * last remaining active admin. The action's only job is to lift the session
 * user id and forward the payload.
 */
export async function updateUserAction(
  input: unknown,
): Promise<ActionResult<ManagedUser>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  // The service re-validates with `UpdateUserSchema`, so a malformed payload
  // surfaces as a 422 instead of a type error. The cast is here only to
  // satisfy the type-checker at the call site.
  const result = await updateUser(input as Parameters<typeof updateUser>[0], access.user.id);

  return fromService(result);
}
