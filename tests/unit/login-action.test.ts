import { describe, expect, it } from "vitest";
import { loginAction } from "@/app/login/actions";

describe("loginAction validation", () => {
  it("rejects empty email or password", async () => {
    const res1 = await loginAction({ email: "", password: "123" });
    expect(res1.success).toBe(false);
    if (!res1.success) {
      expect(res1.error).toContain("đầy đủ email và mật khẩu");
    }

    const res2 = await loginAction({ email: "test@hrpartner.vn", password: "" });
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.error).toContain("đầy đủ email và mật khẩu");
    }

    const res3 = await loginAction({ email: "   ", password: "   " });
    expect(res3.success).toBe(false);
  });
});
