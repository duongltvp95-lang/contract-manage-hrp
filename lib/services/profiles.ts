import "server-only";

import { UpdateProfileSchema } from "@schemas/profile";

import { createClient } from "@/lib/supabase/server";

import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * Profile service — plan sections 30, 71.
 *
 * A user may only edit their own row: RLS restricts the row (`id = auth.uid()`)
 * and a column-level GRANT restricts the columns to `full_name`, so neither
 * `role` nor `organization_id` can be escalated from here even if this code
 * tried. Only `full_name` is ever sent.
 */

export type ProfileSummary = {
  id: string;
  fullName: string | null;
  organizationId: string;
  role: "admin" | "user";
};

/** Plan section 71 — the one editable Profile field in Wave 1. */
export async function updateProfile(
  input: unknown,
  userId: string,
): Promise<ServiceResult<ProfileSummary>> {
  const parsed = UpdateProfileSchema.safeParse(input);

  if (!parsed.success) {
    return err(
      "validation",
      "Thông tin hồ sơ không hợp lệ",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    // `full_name` only — sending anything else would be rejected by the column
    // grant, which is the point of that grant.
    .update({ full_name: parsed.data.fullName })
    // The user id comes from the session, never from the form.
    .eq("id", userId)
    .select("id, full_name, organization_id, role")
    .maybeSingle();

  if (error) {
    return dbError("updateProfile", error);
  }

  if (!data) {
    return err("not_found", "Không tìm thấy hồ sơ của bạn");
  }

  const row = data as {
    id: string;
    full_name: string | null;
    organization_id: string;
    role: string;
  };

  return ok({
    id: row.id,
    fullName: row.full_name,
    organizationId: row.organization_id,
    role: row.role === "admin" ? "admin" : "user",
  });
}
