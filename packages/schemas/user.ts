import { z } from "zod";

/**
 * User-management schemas — feature round 2, part 3 + round 3, part 1.
 *
 * Shared by the Add/Edit forms and the service layer. No `organizationId`
 * field: the organization always comes from the administrator's session, never
 * from the client.
 *
 * The app intentionally has no delete-user action. Removing access is an
 * owner decision, so the schema, the dialog, and the service are all
 * delete-free. Use Supabase Dashboard or service-role helpers for any cleanup
 * the owner approves out of band.
 */

export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Quản trị viên",
  user: "Người dùng",
};

export const CreateUserSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email không được để trống")
    .max(254, "Email tối đa 254 ký tự")
    .pipe(z.email("Email không hợp lệ")),
  fullName: z
    .string()
    .trim()
    .min(1, "Họ tên không được để trống")
    .max(200, "Họ tên tối đa 200 ký tự"),
  /**
   * The owner's rule: a new account is a normal user unless an administrator
   * deliberately says otherwise.
   *
   * No `.default("user")` here on purpose. A Zod default makes the *input* type
   * optional and the *output* type required, which react-hook-form cannot
   * reconcile with a resolver; the default lives where it belongs — the form's
   * initial value — and `createUserAction` coerces anything that is not
   * `"admin"` to `"user"` so an API caller gets the same behaviour.
   */
  role: z.enum(USER_ROLES, { message: "Vai trò không hợp lệ" }),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Round 3, part 1 — change a user's role and/or active state.
 *
 * `fullName` is intentionally NOT editable here: an admin changing another
 * user's display name is a separate decision, and the `profiles_update_own` RLS
 * policy plus the column-level `grant update (full_name)` make it a different
 * code path. Add it in a later round if the owner asks for it.
 *
 * `.refine` rejects a payload that changes nothing, so the server never has to
 * answer "what does it mean to update nothing?".
 */
export const UpdateUserSchema = z
  .object({
    userId: z.uuid({ message: "ID người dùng không hợp lệ" }),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) => value.role !== undefined || value.isActive !== undefined,
    { message: "Không có thay đổi nào để lưu" },
  );

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
