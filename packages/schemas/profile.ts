import { z } from "zod";

/**
 * Shared profile schemas — plan section 71 (Settings).
 *
 * Only `full_name` is editable in Wave 1. Email, role and organization are
 * managed by Supabase Auth / an administrator, and `organization_id` is never
 * client-supplied.
 */

export const UpdateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập họ tên")
    .max(100, "Họ tên tối đa 100 ký tự"),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
