import { z } from "zod";

/**
 * User-management schemas — feature round 2, part 3.
 *
 * Shared by the Add User form and the service layer. No `organizationId` field:
 * the organization always comes from the administrator's session, never from the
 * client.
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
