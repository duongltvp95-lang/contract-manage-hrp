import { z } from "zod";

/**
 * User-management schemas — feature round 2, part 3 + round 3, part 1 +
 * round 4, part 1.
 *
 * Shared by the Add/Edit/Delete forms and the service layer. No
 * `organizationId` field: the organization always comes from the
 * administrator's session, never from the client.
 *
 * Round 4 re-opens the delete path. The "intentionally no delete" promise
 * from round 3 is reversed by the owner (documented in
 * docs/HANDOVER-T2.md mục 0). The product guard — `confirmEmail` re-typing
 * — stays in the schema so a typo cannot take an account down.
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

/**
 * Round 4, part 1 — hard delete a user.
 *
 * The client has to type the user's email again as a confirmation step. The
 * service re-checks the match against the row in auth.users server-side, so a
 * stale form value cannot bypass it.
 */
export const DeleteUserSchema = z.object({
  userId: z.uuid({ message: "ID người dùng không hợp lệ" }),
  confirmEmail: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập email xác nhận")
    .max(254, "Email tối đa 254 ký tự")
    .pipe(z.email("Email không hợp lệ")),
});

export type DeleteUserInput = z.infer<typeof DeleteUserSchema>;
