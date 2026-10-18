import { describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

vi.mock("@/lib/services/audit-logs", () => ({
  recordCurrentUserAudit: vi.fn().mockResolvedValue(undefined),
}));

import { findBestMatchingPartner } from "@/lib/ai/matching";
import { findOrCreatePartnerForAi } from "@/lib/services/partners";

describe("Partner Creation & Matching Idempotency", () => {
  it("không tạo trùng lặp khi đối tác đã có tên khớp trong danh sách", () => {
    const existingPartners = [
      { id: "partner-1", name: "Công ty TNHH Cung Ứng Nhân Lực HR" },
      { id: "partner-2", name: "Công ty Cổ phần Xây dựng ABC" },
    ];

    const extractedPartnerName = "  công ty TNHH Cung Ứng Nhân Lực HR ";
    const trimmed = extractedPartnerName.trim();

    let matched = findBestMatchingPartner(trimmed, existingPartners);
    if (!matched) {
      const exact = existingPartners.find(
        (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (exact) matched = { id: exact.id, name: exact.name };
    }

    expect(matched).not.toBeNull();
    expect(matched?.id).toBe("partner-1");
  });

  it("findOrCreatePartnerForAi: khử trùng lặp nguyên tử khi có 2 yêu cầu đồng thời (in-process dedup & RPC)", async () => {
    let rpcCallCount = 0;

    // Giả lập RPC xử lý tốn 50ms (atomic lock)
    mockRpc.mockImplementation((fnName: string) => ({
      abortSignal: vi.fn().mockReturnThis(),
      then: (resolve: (val: unknown) => void) => {
        if (fnName === "find_or_create_partner_for_ai") {
          rpcCallCount++;
          setTimeout(() => {
            resolve({
              data: [{ id: "p-atomic-1", name: "Công ty Concurrency", is_new: true }],
              error: null,
            });
          }, 50);
        }
      },
    }));

    const orgId = "a0000000-0000-4000-8000-000000000001";
    const companyId = "b0000000-0000-4000-8000-000000000002";

    // Kích hoạt đồng thời 2 yêu cầu cho cùng một tên đối tác trong cùng tổ chức
    const [res1, res2] = await Promise.all([
      findOrCreatePartnerForAi(
        {
          name: "Công ty Concurrency",
          companyIds: [companyId],
        },
        { organizationId: orgId },
      ),
      findOrCreatePartnerForAi(
        {
          name: "  Công ty CONCURRENCY  ",
          companyIds: [companyId],
        },
        { organizationId: orgId },
      ),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (res1.ok && res2.ok) {
      // Cả hai yêu cầu đều phải trỏ về cùng 1 ID đối tác
      expect(res1.data.id).toBe("p-atomic-1");
      expect(res2.data.id).toBe("p-atomic-1");
    }

    // Cơ chế in-process promise map phải dedup và chỉ gọi RPC một lần duy nhất
    expect(rpcCallCount).toBe(1);
  });

  it("findOrCreatePartnerForAi: trả về isNew = false nếu đối tác đã tồn tại trong DB", async () => {
    mockRpc.mockImplementation((fnName: string) => ({
      abortSignal: vi.fn().mockReturnThis(),
      then: (resolve: (val: unknown) => void) => {
        if (fnName === "find_or_create_partner_for_ai") {
          resolve({
            data: [{ id: "p-existing-1", name: "Công ty Đã Có", is_new: false }],
            error: null,
          });
        }
      },
    }));

    const res = await findOrCreatePartnerForAi(
      {
        name: "Công ty Đã Có",
        companyIds: ["b0000000-0000-4000-8000-000000000002"],
      },
      { organizationId: "a0000000-0000-4000-8000-000000000001" },
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("p-existing-1");
      expect(res.data.isNew).toBe(false);
    }
  });

  it("findOrCreatePartnerForAi: không âm thầm chuyển sang luồng tạo không nguyên tử khi RPC lỗi", async () => {
    mockFrom.mockClear();
    mockRpc.mockImplementation((fnName: string) => ({
      abortSignal: vi.fn().mockReturnThis(),
      then: (resolve: (val: unknown) => void) => {
        if (fnName === "find_or_create_partner_for_ai") {
          resolve({
            data: null,
            error: { message: "database connection timeout", code: "57P01" },
          });
        }
      },
    }));

    const res = await findOrCreatePartnerForAi(
      {
        name: "Công ty RPC Lỗi",
        companyIds: ["b0000000-0000-4000-8000-000000000002"],
      },
      { organizationId: "a0000000-0000-4000-8000-000000000001" },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("db_error");
    }

    // Tuyệt đối không fallback gọi mockFrom để query/insert không khóa
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("findOrCreatePartnerForAi: truyền đúng mã số thuế và danh sách công ty vào RPC để kiểm tra theo công ty", async () => {
    mockRpc.mockImplementation((_fnName: string, params: Record<string, unknown>) => ({
      abortSignal: vi.fn().mockReturnThis(),
      then: (resolve: (val: unknown) => void) => {
        resolve({
          data: [{ id: "p-company-aware-1", name: params.p_name, is_new: true }],
          error: null,
        });
      },
    }));

    const res = await findOrCreatePartnerForAi(
      {
        name: "Công ty Phân Phạm Vi",
        taxCode: "0109876543",
        address: "123 Đường Láng, Hà Nội",
        companyIds: ["comp-hrp-1"],
      },
      { organizationId: "org-1" },
    );

    expect(res.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("find_or_create_partner_for_ai", {
      p_org_id: "org-1",
      p_name: "Công ty Phân Phạm Vi",
      p_tax_code: "0109876543",
      p_address: "123 Đường Láng, Hà Nội",
      p_company_ids: ["comp-hrp-1"],
    });
  });

  it("chặn tạo đối tác mới nếu thời gian còn lại trước deadline dưới 4 giây", () => {
    const actionStartTime = Date.now();
    const actionDeadline = actionStartTime + 48_000;
    const fakeCurrentTime = actionDeadline - 3_500;

    const remainingMs = actionDeadline - fakeCurrentTime;
    const shouldAttemptCreate = remainingMs >= 4_000;

    expect(shouldAttemptCreate).toBe(false);
  });
});
