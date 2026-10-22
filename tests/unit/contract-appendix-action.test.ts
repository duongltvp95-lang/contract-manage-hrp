import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockFindBaseContractByNumber = vi.fn();
const mockCreateContract = vi.fn();
const mockCreateClient = vi.fn();

vi.mock("@/lib/auth", () => ({
  resolveAccess: () => mockResolveAccess(),
}));

vi.mock("@/lib/services/contracts", () => ({
  findBaseContractByNumber: (args: unknown) => mockFindBaseContractByNumber(args),
  createContract: (args: unknown, context: unknown) => mockCreateContract(args, context),
  archiveContract: vi.fn(),
  deleteContract: vi.fn(),
  deleteContracts: vi.fn(),
  findDuplicateContract: vi.fn().mockResolvedValue(null),
  unarchiveContract: vi.fn(),
  updateContract: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

import { createContractAction } from "@/app/(app)/contracts/actions";

describe("Server Action: createContractAction - Kiểm tra chặn phụ lục độc lập", () => {
  const orgId = "org-123";
  const user = {
    id: "user-1",
    email: "user@hrpartner.vn",
    role: "user" as const,
    organizationId: orgId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue({
      status: "ok",
      user,
    });
  });

  it("từ chối lưu khi chỉ có tệp phụ lục mà không có tệp hợp đồng chính", async () => {
    const values = {
      contractNumber: "PL-01/2026",
      partnerId: "partner-1",
      companyId: "company-1",
      signedDate: "2026-01-01",
    };
    const intents = [
      {
        id: "f1",
        kind: "appendix" as const,
        aiDocumentType: "appendix" as const,
        baseContractNumber: "HD-100",
      },
    ];

    const res = await createContractAction(values, intents);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("validation");
      expect(res.message).toContain("Không thể lưu hợp đồng khi chưa có hợp đồng gốc");
    }
    expect(mockCreateContract).not.toHaveBeenCalled();
  });

  it("từ chối khi client và AI báo document nhưng tên tệp nhận diện là phụ lục", async () => {
    const res = await createContractAction(
      { contractNumber: "HD-100" },
      [{
        kind: "document",
        aiDocumentType: "document",
        aiContractNumber: "HD-100",
        filename: "Phu luc HD-100.pdf",
      }],
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("validation");
      expect(res.message).toContain("Không thể lưu hợp đồng khi chưa có hợp đồng gốc");
    }
    expect(mockCreateContract).not.toHaveBeenCalled();
  });

  it("từ chối lưu khi phụ lục thuộc hợp đồng đã có sẵn trong cơ sở dữ liệu", async () => {
    mockFindBaseContractByNumber.mockResolvedValue({
      id: "base-contract-99",
      contractNumber: "HD-100",
    });

    const values = {
      contractNumber: "HD-100",
      partnerId: "partner-1",
      companyId: "company-1",
      signedDate: "2026-01-01",
    };
    const intents = [
      {
        id: "doc-1",
        kind: "document" as const,
        aiDocumentType: "document" as const,
        aiContractNumber: "HD-100",
      },
      {
        id: "app-1",
        kind: "appendix" as const,
        aiDocumentType: "appendix" as const,
        baseContractNumber: "HD-100",
        matchedBaseContractId: "base-contract-99",
      },
    ];

    const res = await createContractAction(values, intents);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("validation");
      expect(res.message).toContain("Phụ lục thuộc hợp đồng gốc");
      expect(res.message).toContain("trên hệ thống");
    }
    expect(mockCreateContract).not.toHaveBeenCalled();
  });

  it("cho phép lưu khi có cả hợp đồng chính và phụ lục hợp lệ khớp số hợp đồng", async () => {
    mockFindBaseContractByNumber.mockResolvedValue(null);
    mockCreateContract.mockResolvedValue({
      ok: true,
      data: {
        id: "new-contract-1",
        contract_number: "HD-100",
        partner_id: "partner-1",
        company_id: "company-1",
      },
    });

    const values = {
      contractNumber: "HD-100",
      partnerId: "partner-1",
      companyId: "company-1",
      signedDate: "2026-01-01",
    };
    const intents = [
      {
        id: "doc-1",
        kind: "document" as const,
        aiDocumentType: "document" as const,
        aiContractNumber: "HD-100",
      },
      {
        id: "app-1",
        kind: "appendix" as const,
        aiDocumentType: "appendix" as const,
        baseContractNumber: "HD-100",
      },
    ];

    const res = await createContractAction(values, intents);
    expect(res.ok).toBe(true);
    expect(mockCreateContract).toHaveBeenCalledTimes(1);
  });
});
