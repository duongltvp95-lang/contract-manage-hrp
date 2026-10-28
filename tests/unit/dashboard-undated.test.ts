import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

import { getUndatedContracts } from "@/lib/services/dashboard";

describe("Dashboard - getUndatedContracts (Hợp đồng không ngày ký, không ngày hết hạn, không giới hạn)", () => {
  const orgId = "org-test-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gọi query Supabase với các điều kiện lọc hợp đồng không ngày hoặc không thời hạn", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: [
        {
          id: "c1",
          organization_id: orgId,
          contract_number: "HD-001",
          signed_date: null,
          expiry_date: null,
          duration_text: "Không xác định thời hạn",
          notes: "Cần kiểm tra lại phụ lục 1",
          partner: { name: "Công ty ABC" },
          company: { name: "HR VN" },
        },
      ],
      count: 1,
      error: null,
    });

    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockOr = vi.fn().mockReturnValue({ order: mockOrder });
    const mockIs = vi.fn().mockReturnValue({ or: mockOr });
    const mockEq = vi.fn().mockReturnValue({ is: mockIs });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    mockCreateClient.mockResolvedValue({
      from: mockFrom,
    });

    const result = await getUndatedContracts(orgId, 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.total).toBe(1);
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0].contract_number).toBe("HD-001");
    expect(result.data.rows[0].partnerName).toBe("Công ty ABC");
    expect(result.data.rows[0].companies).toEqual(["HR VN"]);
    expect(result.data.rows[0].notes).toBe("Cần kiểm tra lại phụ lục 1");

    expect(mockFrom).toHaveBeenCalledWith("contracts");
    expect(mockEq).toHaveBeenCalledWith("organization_id", orgId);
    expect(mockIs).toHaveBeenCalledWith("archived_at", null);
    expect(mockOr).toHaveBeenCalledWith(
      expect.stringContaining("signed_date.is.null,expiry_date.is.null"),
    );
  });

  it("trả về lỗi database khi Supabase báo lỗi", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: null,
      count: null,
      error: { message: "Database connection failed", code: "500" },
    });

    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockOr = vi.fn().mockReturnValue({ order: mockOrder });
    const mockIs = vi.fn().mockReturnValue({ or: mockOr });
    const mockEq = vi.fn().mockReturnValue({ is: mockIs });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    mockCreateClient.mockResolvedValue({
      from: mockFrom,
    });

    const result = await getUndatedContracts(orgId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("db_error");
  });
});
