import { z } from "zod";

import { AccentKeySchema } from "./theme";

/**
 * Shared profile schemas — plan section 71 (Settings).
 *
 * Only `full_name` is editable in Wave 1. Email, role and organization are
 * managed by Supabase Auth / an administrator, and `organization_id` is never
 * client-supplied.
 *
 * Round 12 adds `accentColor` (optional): the UI accent preset key, or null to
 * clear back to the default.
 */

/**
 * Round 12: `fullName` is optional (the accent picker updates only
 * `accentColor`), and `accentColor` is the UI accent preset key, or null to
 * clear back to the default.
 */
export const UpdateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập họ tên")
    .max(100, "Họ tên tối đa 100 ký tự")
    .optional(),
  accentColor: AccentKeySchema.nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
