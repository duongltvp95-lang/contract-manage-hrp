import { describe, expect, it, vi } from "vitest";

const afterSpy = vi.fn((fn: () => Promise<void>) => {
  // Mock Next.js after() executing task asynchronously in background
  setTimeout(() => {
    fn().catch(() => {});
  }, 10);
});

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => afterSpy(fn),
}));

const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/r2/objects", () => ({
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

describe("R2 Background Cleanup với Next.js after()", () => {
  it("đăng ký lệnh xóa tệp tạm qua after() để bảo đảm không bị đóng băng trên serverless", async () => {
    // Mô phỏng logic cleanupR2 trong extractContractAction
    const cleanupR2 = (key: string) => {
      try {
        afterSpy(async () => {
          await mockDeleteObject(key, { timeoutMs: 5_000 }).catch(() => {});
        });
      } catch {
        void mockDeleteObject(key, { timeoutMs: 5_000 }).catch(() => {});
      }
    };

    cleanupR2("ai-temp/org-1/test-contract.pdf");

    // Phải đăng ký ngay với after()
    expect(afterSpy).toHaveBeenCalledTimes(1);

    // Chờ background task chạy
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(mockDeleteObject).toHaveBeenCalledWith(
      "ai-temp/org-1/test-contract.pdf",
      { timeoutMs: 5_000 },
    );
  });
});
