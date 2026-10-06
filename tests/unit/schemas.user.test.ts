import { describe, expect, it } from "vitest";

import {
  CreateUserSchema,
  UpdateUserSchema,
  USER_ROLE_LABELS,
  USER_ROLES,
} from "@schemas/user";

/**
 * Feature round 2, part 3 — shared validation for the Add User form.
 *
 * The same schema backs the form and the service, so these assertions are the
 * contract between the two.
 */

describe("CreateUserSchema", () => {
  const valid = {
    email: "nguyen.van.a@hrpartner.vn",
    fullName: "Nguyễn Văn A",
    role: "user" as const,
  };

  it("accepts a normal payload", () => {
    const parsed = CreateUserSchema.safeParse(valid);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(valid);
  });

  it("trims the email and the name", () => {
    const parsed = CreateUserSchema.safeParse({
      email: "  a@b.vn  ",
      fullName: "  Nguyễn Văn A  ",
      role: "user",
    });

    expect(parsed.data?.email).toBe("a@b.vn");
    expect(parsed.data?.fullName).toBe("Nguyễn Văn A");
  });

  it("rejects an address that is not an email", () => {
    for (const email of ["không-phải-email", "a@", "@b.vn", "a b@c.vn", ""]) {
      expect(CreateUserSchema.safeParse({ ...valid, email }).success).toBe(false);
    }
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(CreateUserSchema.safeParse({ ...valid, fullName: "" }).success).toBe(false);
    expect(CreateUserSchema.safeParse({ ...valid, fullName: "   " }).success).toBe(false);
  });

  it("accepts 200 characters of name and rejects 201", () => {
    expect(
      CreateUserSchema.safeParse({ ...valid, fullName: "a".repeat(200) }).success,
    ).toBe(true);
    expect(
      CreateUserSchema.safeParse({ ...valid, fullName: "a".repeat(201) }).success,
    ).toBe(false);
  });

  it("accepts only the two known roles", () => {
    expect(CreateUserSchema.safeParse({ ...valid, role: "admin" }).success).toBe(true);
    expect(CreateUserSchema.safeParse({ ...valid, role: "user" }).success).toBe(true);
    expect(CreateUserSchema.safeParse({ ...valid, role: "owner" }).success).toBe(false);
    expect(CreateUserSchema.safeParse({ ...valid, role: "ADMIN" }).success).toBe(false);
  });

  it("requires a role, so nothing is silently promoted", () => {
    // The "default is user" rule lives in the form's initial value and in
    // `createUserAction`; the schema itself refuses to guess.
    expect(CreateUserSchema.safeParse({ email: valid.email, fullName: valid.fullName }).success).toBe(
      false,
    );
  });

  it("carries Vietnamese labels for both roles", () => {
    expect(USER_ROLES).toEqual(["admin", "user"]);
    expect(USER_ROLE_LABELS.admin).toBe("Quản trị viên");
    expect(USER_ROLE_LABELS.user).toBe("Người dùng");
  });
});

/**
 * Round 3, part 1 — admin update + delete payloads.
 *
 * The schemas here are the contract between the Edit/Delete dialogs and the
 * service layer. `UpdateUserSchema` requires at least one of { role, isActive }
 * because a "no change" request would be a wasted round-trip and an audit
 * row that says nothing happened.
 */

const userId = "11111111-1111-4111-8111-111111111111";

describe("UpdateUserSchema", () => {
  it("accepts a role change", () => {
    const parsed = UpdateUserSchema.safeParse({ userId, role: "admin" });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.role).toBe("admin");
  });

  it("accepts an isActive change", () => {
    const parsed = UpdateUserSchema.safeParse({ userId, isActive: false });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.isActive).toBe(false);
  });

  it("accepts both fields at once", () => {
    const parsed = UpdateUserSchema.safeParse({
      userId,
      role: "user",
      isActive: false,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a payload that changes nothing", () => {
    const parsed = UpdateUserSchema.safeParse({ userId });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Không có thay đổi nào để lưu");
  });

  it("rejects an unknown role", () => {
    expect(
      UpdateUserSchema.safeParse({ userId, role: "owner" }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid userId", () => {
    expect(
      UpdateUserSchema.safeParse({ userId: "not-a-uuid", role: "admin" }).success,
    ).toBe(false);
  });
});

