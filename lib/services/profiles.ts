import "server-only";

import { UpdateProfileSchema } from "@schemas/profile";

import { createClient } from "@/lib/supabase/server";

import { recordCurrentUserAudit } from "./audit-logs";
import { dbError, err, ok, type ServiceResult } from "./types";

/**
 * Profile service — plan sections 30, 71; round 12 + 13 + 14.
 *
 * A user may only edit their own row: RLS restricts the row (`id = auth.uid()`)
 * and a column-level GRANT restricts the columns to `full_name`, `accent_color`,
 * `background_color` and `sidebar_color`, so neither `role` nor
 * `organization_id` can be escalated from here even if this code tried.
 */

export type ProfileSummary = {
  id: string;
  fullName: string | null;
  organizationId: string;
  role: "admin" | "user";
  accentColor: string | null;
  backgroundColor: string | null;
  sidebarColor: string | null;
};

/** Plan section 71 — the editable Profile fields (name + theme colors). */
export async function updateProfile(
  input: unknown,
  userId: string,
): Promise<ServiceResult<ProfileSummary>> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const parsed = UpdateProfileSchema.safeParse(raw);

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

  // Partial-write rule: each column is only written when the caller actually
  // sent its key, so an omitted key never clears a value it did not mean to
  // touch. The profile form sends the name; the pickers send one preset key.
  const patch: Record<string, string | null> = {};
  if ("fullName" in raw) patch.full_name = parsed.data.fullName ?? "";
  if ("accentColor" in raw) patch.accent_color = parsed.data.accentColor ?? null;
  if ("backgroundColor" in raw) patch.background_color = parsed.data.backgroundColor ?? null;
  if ("sidebarColor" in raw) patch.sidebar_color = parsed.data.sidebarColor ?? null;

  if (Object.keys(patch).length === 0) {
    return err("validation", "Không có thay đổi nào để lưu");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    // Only the granted columns — anything else is rejected by the column grant.
    .update(patch)
    // The user id comes from the session, never from the form.
    .eq("id", userId)
    .select("id, full_name, organization_id, role, accent_color, background_color, sidebar_color")
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
    accent_color: string | null;
    background_color: string | null;
    sidebar_color: string | null;
  };

  const changed: string[] = [];
  if ("fullName" in raw) changed.push("fullName");
  if ("accentColor" in raw) changed.push("accentColor");
  if ("backgroundColor" in raw) changed.push("backgroundColor");
  if ("sidebarColor" in raw) changed.push("sidebarColor");

  await recordCurrentUserAudit({
    action: "update_profile",
    targetKind: "profile",
    targetId: userId,
    metadata: { changed },
  });

  return ok({
    id: row.id,
    fullName: row.full_name,
    organizationId: row.organization_id,
    role: row.role === "admin" ? "admin" : "user",
    accentColor: row.accent_color ?? null,
    backgroundColor: row.background_color ?? null,
    sidebarColor: row.sidebar_color ?? null,
  });
}
