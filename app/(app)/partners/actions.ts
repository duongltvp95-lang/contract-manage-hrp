"use server";

import {
  createPartner,
  searchPartners,
  updatePartner,
  type PartnerRow,
  type PartnerSearchRow,
} from "@/lib/services/partners";
import {
  authorized,
  fromService,
  validationFailure,
  type ActionResult,
} from "@/lib/server-action";

/**
 * Server actions for the partner directory — feature round 2, part 2.
 *
 * There is no delete action here, and there will not be one. The database
 * revokes DELETE from `authenticated` and defines no DELETE policy, so such an
 * action could not work even if someone added it — the UI and the API agree that
 * a partner referenced by contracts is removed only by an explicit owner
 * decision taken with those contracts in view.
 *
 * `organizationId` always comes from the session via `authorized()`; it is never
 * read from the arguments.
 */

export async function createPartnerAction(
  input: unknown,
): Promise<ActionResult<PartnerRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const result = await createPartner((input ?? {}) as Record<string, unknown>, {
    organizationId: access.user.organizationId,
  });

  return fromService(result);
}

/**
 * Quick search for the combobox (round 6). The term comes from the user's
 * keystrokes; the organization always comes from the session.
 */
export async function searchPartnersAction(
  term: unknown,
): Promise<ActionResult<PartnerSearchRow[]>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  const query = typeof term === "string" ? term : "";
  const result = await searchPartners(query);

  return fromService(result);
}

export async function updatePartnerAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult<PartnerRow>> {
  const access = await authorized();
  if (!access.ok) return access.result;

  if (typeof id !== "string" || id.length === 0) {
    return validationFailure("Thiếu thông tin đối tác", [
      { path: "id", message: "Không xác định được đối tác cần sửa" },
    ]);
  }

  const result = await updatePartner(id, (input ?? {}) as Record<string, unknown>, {
    organizationId: access.user.organizationId,
  });

  return fromService(result);
}
