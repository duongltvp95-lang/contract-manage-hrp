import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockCompleteUpload = vi.fn();
const mockRecordCurrentUserAudit = vi.fn();
const mockCreateClient = vi.fn();

vi.mock("@/lib/auth", () => ({
  resolveAccess: () => mockResolveAccess(),
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/services/files", () => ({
  completeUpload: (args: unknown) => mockCompleteUpload(args),
  deleteContractFile: vi.fn(),
}));

vi.mock("@/lib/services/audit-logs", () => ({
  recordCurrentUserAudit: (args: unknown) => mockRecordCurrentUserAudit(args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

import { RenewContractSchema } from "@schemas/contract";
import { renewContract } from "@/lib/services/contracts";
import { renewContractAction } from "@/app/(app)/contracts/actions";

describe("Manual Contract Renewal (Gia hạn hợp đồng thủ công)", () => {
  const orgId = "org-111";
  const user = {
    id: "user-1",
    email: "admin@hrpartner.vn",
    role: "admin" as const,
    organizationId: orgId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue({
      status: "ok",
      user,
    });
  });

  describe("RenewContractSchema", () => {
    it("chấp nhận dữ liệu gia hạn hợp lệ", () => {
      const parsed = RenewContractSchema.safeParse({
        contractId: "11111111-1111-4111-8111-111111111111",
        newExpiryDate: "2027-10-26",
        newDurationText: "Gia hạn 1 năm",
        notes: "Gia hạn theo thỏa thuận hai bên",
      });
      expect(parsed.success).toBe(true);
    });

    it("từ chối khi contractId không phải UUID", () => {
      const parsed = RenewContractSchema.safeParse({
        contractId: "invalid-id",
        newExpiryDate: "2027-10-26",
      });
      expect(parsed.success).toBe(false);
    });

    it("từ chối khi newExpiryDate không hợp lệ (ví dụ ngày 31/02)", () => {
      const parsed = RenewContractSchema.safeParse({
        contractId: "11111111-1111-4111-8111-111111111111",
        newExpiryDate: "2027-02-31",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("renewContract service", () => {
    it("từ chối gia hạn khi ngày hết hạn mới trước ngày ký hợp đồng", async () => {
      // Mock Supabase client
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "contract-1",
                contract_number: "HD-001",
                signed_date: "2026-06-01",
                expiry_date: "2026-10-01",
                archived_at: null,
                notes: null,
              },
              error: null,
            }),
          }),
        }),
      });

      vi.mocked(mockCreateClient).mockReturnValue({
        from: () => ({
          select: mockSelect,
        }),
      } as unknown as ReturnType<typeof mockCreateClient>);

      const result = await renewContract(
        "contract-1",
        {
          newExpiryDate: "2026-05-01", // Trước ngày ký 2026-06-01
        },
        {
          userId: user.id,
          organizationId: orgId,
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("validation");
        expect(result.message).toContain("không thể trước ngày ký hợp đồng");
      }
    });

    it("từ chối gia hạn khi hợp đồng đã bị lưu trữ (archived)", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "contract-archived",
                contract_number: "HD-002",
                signed_date: "2025-01-01",
                expiry_date: "2026-01-01",
                archived_at: "2026-02-01T00:00:00Z",
                notes: null,
              },
              error: null,
            }),
          }),
        }),
      });

      vi.mocked(mockCreateClient).mockReturnValue({
        from: () => ({
          select: mockSelect,
        }),
      } as unknown as ReturnType<typeof mockCreateClient>);

      const result = await renewContract(
        "contract-archived",
        {
          newExpiryDate: "2027-01-01",
        },
        {
          userId: user.id,
          organizationId: orgId,
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("forbidden");
        expect(result.message).toContain("Không thể gia hạn hợp đồng đã lưu trữ");
      }
    });

    it("gia hạn thành công khi ngày hợp lệ, cập nhật expiry_date và ghi audit log", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "contract-ok",
                contract_number: "HD-003",
                signed_date: "2025-01-01",
                expiry_date: "2026-01-01",
                archived_at: null,
                notes: "Ghi chú cũ",
              },
              error: null,
            }),
          }),
        }),
      });

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "contract-ok",
                    organization_id: orgId,
                    contract_number: "HD-003",
                    signed_date: "2025-01-01",
                    expiry_date: "2027-01-01",
                    duration_text: "Gia hạn 1 năm",
                    notes: "Ghi chú cũ\n[Gia hạn 26/10/2026: Hạn mới 01/01/2027] Gia hạn thêm 1 năm",
                    archived_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      vi.mocked(mockCreateClient).mockReturnValue({
        from: () => ({
          select: mockSelect,
          update: mockUpdate,
        }),
      } as unknown as ReturnType<typeof mockCreateClient>);

      const result = await renewContract(
        "contract-ok",
        {
          newExpiryDate: "2027-01-01",
          newDurationText: "Gia hạn 1 năm",
          renewalNote: "Gia hạn thêm 1 năm",
        },
        {
          userId: user.id,
          organizationId: orgId,
        },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.expiry_date).toBe("2027-01-01");
      }
      expect(mockRecordCurrentUserAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "update_contract",
          targetKind: "contract",
          targetId: "contract-ok",
        }),
      );
    });
  });

  describe("renewContractAction Server Action", () => {
    it("từ chối khi payload không có newExpiryDate hợp lệ", async () => {
      const res = await renewContractAction({
        contractId: "11111111-1111-4111-8111-111111111111",
        newExpiryDate: "",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("validation");
      }
    });

    it("gọi completeUpload khi có tệp phụ lục gia hạn đính kèm", async () => {
      mockCompleteUpload.mockResolvedValue({
        ok: false,
        code: "validation",
        message: "Lỗi lưu phụ lục",
      });

      const res = await renewContractAction({
        contractId: "11111111-1111-4111-8111-111111111111",
        newExpiryDate: "2027-10-26",
        appendixFile: {
          fileId: "file-123",
          objectKey: "contracts/org-111/11111111-1111-4111-8111-111111111111/file-123/pl.pdf",
          uploadReservation: "res-1",
          filename: "pl.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
          baseContractNumber: "HD-01",
        },
      });

      expect(mockCompleteUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: "11111111-1111-4111-8111-111111111111",
          fileId: "file-123",
          kind: "appendix",
        }),
      );
      expect(res.ok).toBe(false);
    });
  });
});
