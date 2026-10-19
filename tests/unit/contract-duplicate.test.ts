import { describe, expect, it, vi } from "vitest";
import { findDuplicateContract, findBaseContractByNumber, createContract } from "@/lib/services/contracts";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/services/partners", () => ({
  getPartner: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: "p1", name: "Đối tác A" },
  }),
  getCompany: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: "c1", name: "HRP" },
  }),
}));

vi.mock("./audit-logs", () => ({
  recordCurrentUserAudit: vi.fn().mockResolvedValue(undefined),
}));

import { createClient } from "@/lib/supabase/server";

describe("Duplicate Contract Detection", () => {
  const orgId = "11111111-1111-1111-1111-111111111111";
  const userId = "user-123";

  it("findDuplicateContract returns null when contractNumber is empty", async () => {
    const result = await findDuplicateContract({
      contractNumber: "",
      signedDate: "2026-01-01",
      expiryDate: "2027-01-01",
      organizationId: orgId,
    });
    expect(result).toBeNull();
  });

  it("findDuplicateContract queries Supabase with escaped contract_number, signed_date and expiry_date", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: "contract-1",
        contract_number: "HD-01/2026",
        signed_date: "2026-01-01",
        expiry_date: "2027-01-01",
        archived_at: null,
      },
      error: null,
    });

    const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockSingle });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockExpiry = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSigned = vi.fn().mockReturnValue({ eq: mockExpiry });
    const mockIlike = vi.fn().mockReturnValue({ eq: mockSigned });
    const mockArchived = vi.fn().mockReturnValue({ ilike: mockIlike });
    const mockOrg = vi.fn().mockReturnValue({ is: mockArchived });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockOrg });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: mockFrom,
    });

    const result = await findDuplicateContract({
      contractNumber: "HD-01/2026",
      signedDate: "2026-01-01",
      expiryDate: "2027-01-01",
      organizationId: orgId,
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe("contract-1");
    expect(mockFrom).toHaveBeenCalledWith("contracts");
    expect(mockOrg).toHaveBeenCalledWith("organization_id", orgId);
    expect(mockArchived).toHaveBeenCalledWith("archived_at", null);
    expect(mockIlike).toHaveBeenCalledWith("contract_number", "HD-01/2026");
    expect(mockSigned).toHaveBeenCalledWith("signed_date", "2026-01-01");
    expect(mockExpiry).toHaveBeenCalledWith("expiry_date", "2027-01-01");
  });

  it("createContract rejects with validation error when identical contract is found", async () => {
    const mockDuplicate = {
      id: "contract-dup-123",
      contract_number: "2024.03.01/HRVN - DONGYANG",
      signed_date: "2024-03-01",
      expiry_date: "2025-03-01",
      archived_at: null,
    };

    const mockSingle = vi.fn().mockResolvedValue({
      data: mockDuplicate,
      error: null,
    });

    const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockSingle });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockExpiry = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSigned = vi.fn().mockReturnValue({ eq: mockExpiry });
    const mockIlike = vi.fn().mockReturnValue({ eq: mockSigned });
    const mockArchived = vi.fn().mockReturnValue({ ilike: mockIlike });
    const mockOrg = vi.fn().mockReturnValue({ is: mockArchived });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockOrg });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: mockFrom,
    });

    const response = await createContract(
      {
        contractNumber: "2024.03.01/HRVN - DONGYANG",
        signedDate: "2024-03-01",
        expiryDate: "2025-03-01",
        partnerId: "00000000-0000-4000-8000-000000000010",
        companyId: "00000000-0000-4000-8000-000000000001",
      },
      {
        userId,
        organizationId: orgId,
      },
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.code).toBe("validation");
      expect(response.message).toContain("2024.03.01/HRVN - DONGYANG");
      expect(response.message).toContain("đã tồn tại trong hệ thống");
      expect(response.message).toContain("01/03/2024");
      expect(response.message).toContain("01/03/2025");
    }
  });

  it("findBaseContractByNumber returns null when contractNumber is empty", async () => {
    const result = await findBaseContractByNumber({
      contractNumber: "",
      organizationId: orgId,
    });
    expect(result).toBeNull();
  });

  it("findBaseContractByNumber finds base contract and resolves partner name", async () => {
    const mockData = {
      id: "base-contract-1",
      contract_number: "123/2026/HĐKT",
      signed_date: "2026-01-01",
      expiry_date: "2027-01-01",
      partner_text: null,
      partner_id: "p1",
      partners: { name: "Đối tác Công ty ABC" },
    };

    const mockLimit = vi.fn().mockResolvedValue({
      data: [mockData],
      error: null,
    });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockIlike = vi.fn().mockReturnValue({ order: mockOrder });
    const mockArchived = vi.fn().mockReturnValue({ ilike: mockIlike });
    const mockOrg = vi.fn().mockReturnValue({ is: mockArchived });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockOrg });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: mockFrom,
    });

    const result = await findBaseContractByNumber({
      contractNumber: "123/2026/HĐKT",
      organizationId: orgId,
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe("base-contract-1");
    expect(result?.contractNumber).toBe("123/2026/HĐKT");
    expect(result?.partnerName).toBe("Đối tác Công ty ABC");
  });
});
