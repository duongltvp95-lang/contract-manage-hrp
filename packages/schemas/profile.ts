import { z } from "zod";

import { AccentKeySchema, BackgroundKeySchema } from "./theme";

/**
 * Shared profile schemas — plan section 71 (Settings).
 *
 * Only `full_name` is editable in Wave 1. Email, role and organization are
 * managed by Supabase Auth / an administrator, and `organization_id` is never
 * client-supplied.
 *
 * Round 12 adds `accentColor`; round 13 adds `backgroundColor` — the UI preset
 * keys, or null to clear back to the default.
 */

/**
 * `fullName` is optional (the accent/background pickers update only their own
 * key), and the two preset keys are optional enum-or-null.
 */
export const UpdateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập họ tên")
    .max(100, "Họ tên tối đa 100 ký tự")
    .optional(),
  accentColor: AccentKeySchema.nullable().optional(),
  backgroundColor: BackgroundKeySchema.nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
