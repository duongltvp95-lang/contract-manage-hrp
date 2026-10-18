import { describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn().mockImplementation((options?: { abortSignal?: AbortSignal }) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
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
    );

    if (options?.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("AbortError"));
      });
    }
  });
});

vi.mock("@/lib/auth", () => ({
  resolveAccess: (options?: { abortSignal?: AbortSignal }) => mockResolveAccess(options),
}));

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(() => {
    return {
      from: mockFrom,
      rpc: mockRpc,
    };
  }),
}));

import { authorized } from "@/lib/server-action";
import { createPartner } from "@/lib/services/partners";

describe("I/O Timeout & Abort Handling", () => {
  it("authorized() truyền abortSignal vào resolveAccess và trả về timeout error khi quá hạn", async () => {
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

    expect(mockResolveAccess).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("createPartner trả về lỗi ngay lập tức nếu abortSignal đã bị hủy từ trước", async () => {
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

  it("createPartner hủy thao tác giữa chừng khi abortSignal kích hoạt trong lúc đang chạy I/O", async () => {
    const controller = new AbortController();

    // Giả lập listCompanies đang chạy query thì signal bị abort
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockImplementation((signal: AbortSignal) => ({
        then: (_resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
          signal.addEventListener("abort", () => {
            reject(new Error("AbortError"));
          });
        },
      })),
    };

    mockFrom.mockReturnValue(mockQueryBuilder);

    const partnerPromise = createPartner(
      {
        name: "Công ty Xây Dựng Số 1",
        companyIds: ["a0000000-0000-4000-8000-000000000001"],
      },
      { organizationId: "a0000000-0000-4000-8000-000000000001" },
      { abortSignal: controller.signal },
    );

    // Kích hoạt abort sau 20ms trong lúc query đang pending
    setTimeout(() => {
      controller.abort();
    }, 20);

    const result = await partnerPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("db_error");
    }
  });
});
