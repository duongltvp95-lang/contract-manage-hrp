"use server";

import { updateProfile, type ProfileSummary } from "@/lib/services/profiles";
import { authorized, fromService, type ActionResult } from "@/lib/server-action";

/**
 * Settings server actions — plan section 71.
 *
 * The user id comes from the session; the form only ever supplies `fullName`.
 */

export async function updateProfileAction(
  input: unknown,
): Promise<ActionResult<ProfileSummary>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const result = await updateProfile(input, access.user.id);

  return fromService(result);
}
