import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  resolveAccess: vi.fn().mockImplementation(() => {
    // Giả lập auth check bị treo / chậm (500ms)
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            status: "ok",
            user: {
              id: "user-1",
              email: "test@example.com",
              fullName: "Tester",
              organizationId: "org-1",
              role: "admin",
            },
          }),
        500,
      ),
    );
  }),
}));

import { authorized } from "@/lib/server-action";
import { createPartner } from "@/lib/services/partners";

describe("I/O Timeout & Abort Handling", () => {
  it("authorized() trả về timeout error khi auth check vượt quá timeoutMs", async () => {
    const result = await authorized({ timeoutMs: 30 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const authErr = result.result;
      expect(authErr.ok).toBe(false);
      if (!authErr.ok) {
        expect(authErr.code).toBe("timeout");
        expect(authErr.message).toContain("Quá thời gian xác thực");
      }
    }
  });

  it("createPartner trả về lỗi timeout ngay lập tức nếu abortSignal đã bị hủy", async () => {
    const abortedSignal = AbortSignal.abort();

    const result = await createPartner(
      {
        name: "Công ty Test",
        companyIds: ["comp-1"],
      },
      { organizationId: "org-1" },
      { abortSignal: abortedSignal },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("db_error");
      expect(result.message).toContain("đã bị hủy");
    }
  });
});
