import "server-only";

import { createClient } from "@/lib/supabase/server";

import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * Organization service — plan section 29.
 *
 * Wave 1 is view-only (the owner decision for M7): the name is displayed in
 * Settings, and the RLS policies deliberately grant no INSERT / UPDATE / DELETE,
 * so there is no service function to change it.
 */

export type OrganizationSummary = {
  id: string;
  name: string;
  createdAt: string;
};

/** Returns the organization only when it is the caller's own. */
export async function getOrganization(
  organizationId: string,
): Promise<ServiceResult<OrganizationSummary>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, created_at")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    return dbError("getOrganization", error);
  }

  if (!data) {
    return err("not_found", "Không tìm thấy tổ chức");
  }

  const row = data as { id: string; name: string; created_at: string };

  return ok({ id: row.id, name: row.name, createdAt: row.created_at });
}
