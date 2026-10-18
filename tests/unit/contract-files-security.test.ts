import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockDeleteObject = vi.fn();
const mockHeadObject = vi.fn();
const mockCreateUploadUrl = vi.fn();
const mockConsumeRateLimit = vi.fn();
const mockResolveAccess = vi.fn();

vi.mock("@/lib/auth", () => ({
  resolveAccess: () => mockResolveAccess(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock("@/lib/r2/objects", () => ({
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  headObject: (...args: unknown[]) => mockHeadObject(...args),
}));

vi.mock("@/lib/r2/presign", () => ({
  createUploadUrl: (...args: unknown[]) => mockCreateUploadUrl(...args),
  createViewUrl: vi.fn().mockResolvedValue("https://r2.example.com/view-url"),
  VIEW_URL_TTL_SECONDS: 900,
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
}));

vi.mock("@/lib/services/audit-logs", () => ({
  recordCurrentUserAudit: vi.fn().mockResolvedValue(undefined),
}));

import {
  completeUpload,
  createUploadRequest,
  deleteContractFile,
  getContractFileAccess,
} from "@/lib/services/files";
import { enqueueR2Cleanup, processR2CleanupQueue } from "@/lib/services/storage-cleanup";
import { guardFileApiRequest } from "@/lib/api-guard";
import { OWNER_EMAIL } from "@/lib/owner";

function createChainableMock(resolvedData: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: resolvedData, error });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData, error });
  chain.then = (resolve: (val: unknown) => void) => resolve({ data: resolvedData, error });
  return chain;
}

describe("Contract Files Security & Access Control", () => {
  const origEnv = { ...process.env };
  const orgId = "11111111-1111-1111-1111-111111111111";
  const contractId = "22222222-2222-2222-2222-222222222222";
  const fileId = "33333333-3333-3333-3333-333333333333";
  const objectKey = `contracts/${orgId}/${contractId}/${fileId}/doc.pdf`;
  const nonAdminEmail = "viewer@hrpartner.vn";
  const adminEmail = OWNER_EMAIL;

  beforeAll(() => {
    process.env.R2_ACCOUNT_ID = "mock-account";
    process.env.R2_ENDPOINT = "https://mock-account.r2.cloudflarestorage.com";
    process.env.R2_BUCKET_NAME = "mock-bucket";
    process.env.R2_ACCESS_KEY_ID = "mock-access-key";
    process.env.R2_SECRET_ACCESS_KEY = "mock-secret-access-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
  });

  afterAll(() => {
    process.env = origEnv;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("[P1] getContractFileAccess & Archived Contracts", () => {
    it("chặn upload tệp vào hợp đồng đã lưu trữ với mã lỗi validation", async () => {
      mockCreateClient.mockReturnValue({
        from: () => createChainableMock({ id: contractId, archived_at: "2026-10-18T00:00:00Z" }),
      });

      const res = await getContractFileAccess(orgId, contractId, undefined, {
        userEmail: adminEmail,
        forUpload: true,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("validation");
        expect(res.message).toContain("lưu trữ");
      }
    });

    it("chặn người dùng thông thường xem tệp của hợp đồng đã lưu trữ", async () => {
      mockCreateClient.mockReturnValue({
        from: () => createChainableMock({ id: contractId, archived_at: "2026-10-18T00:00:00Z" }),
      });

      const res = await getContractFileAccess(orgId, contractId, fileId, {
        userEmail: nonAdminEmail,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("forbidden");
        expect(res.message).toContain("quyền");
      }
    });

    it("cho phép admin/owner xem tệp của hợp đồng đã lưu trữ", async () => {
      const mockFile = {
        id: fileId,
        contract_id: contractId,
        object_key: objectKey,
        original_filename: "doc.pdf",
        mime_type: "application/pdf",
        file_size_bytes: 1024,
        kind: "main",
        organization_id: orgId,
        created_at: "2026-10-18T00:00:00Z",
        created_by: "user-1",
      };

      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: "2026-10-18T00:00:00Z" });
          }
          if (table === "contract_files") {
            return createChainableMock(mockFile);
          }
          return createChainableMock(null);
        },
      });

      const res = await getContractFileAccess(orgId, contractId, fileId, {
        userEmail: adminEmail,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.file?.id).toBe(fileId);
      }
    });
  });

  describe("[P1] deleteContractFile: Quyền và thứ tự xóa DB trước, R2 sau", () => {
    it("từ chối xóa tệp nếu người gọi không có quyền delete admin", async () => {
      const res = await deleteContractFile(fileId, orgId, nonAdminEmail);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("forbidden");
        expect(res.message).toContain("quyền");
      }
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("từ chối xóa tệp nếu hợp đồng đã lưu trữ", async () => {
      mockCreateAdminClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contract_files") {
            return createChainableMock({
              id: fileId,
              contract_id: contractId,
              object_key: "contracts/key.pdf",
              organization_id: orgId,
              original_filename: "doc.pdf",
            });
          }
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: "2026-10-18T00:00:00Z" });
          }
          return createChainableMock(null);
        },
      });

      const res = await deleteContractFile(fileId, orgId, adminEmail);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("validation");
        expect(res.message).toContain("lưu trữ");
      }
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("xóa hàng DB trước; nếu xóa DB thất bại thì KHÔNG xóa object R2", async () => {
      const filesMock = createChainableMock({
        id: fileId,
        contract_id: contractId,
        object_key: "contracts/key.pdf",
        organization_id: orgId,
        original_filename: "doc.pdf",
      });
      // Override delete method to fail
      filesMock.delete = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: { message: "database error", code: "42501" },
          }),
        }),
      });

      mockCreateAdminClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contract_files") {
            return filesMock;
          }
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          return createChainableMock(null);
        },
      });

      const res = await deleteContractFile(fileId, orgId, adminEmail);
      expect(res.ok).toBe(false);
      expect(filesMock.delete).toHaveBeenCalled();
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("xóa R2 sau khi xóa DB thành công bằng service-role client", async () => {
      const filesMock = createChainableMock({
        id: fileId,
        contract_id: contractId,
        object_key: "contracts/key.pdf",
        organization_id: orgId,
        original_filename: "doc.pdf",
      });
      filesMock.delete = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      mockCreateAdminClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contract_files") {
            return filesMock;
          }
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          return createChainableMock(null);
        },
      });

      mockDeleteObject.mockResolvedValue(undefined);

      const res = await deleteContractFile(fileId, orgId, adminEmail);
      expect(res.ok).toBe(true);
      expect(filesMock.delete).toHaveBeenCalled();
      expect(mockDeleteObject).toHaveBeenCalledWith("contracts/key.pdf");
    });

    it("nếu xóa R2 thất bại sau khi xóa DB, đưa vào hàng đợi r2_cleanup_queue", async () => {
      const filesMock = createChainableMock({
        id: fileId,
        contract_id: contractId,
        object_key: "contracts/key.pdf",
        organization_id: orgId,
        original_filename: "doc.pdf",
      });
      filesMock.delete = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      const queueInsertMock = vi.fn().mockResolvedValue({ error: null });

      mockCreateAdminClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contract_files") {
            return filesMock;
          }
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          if (table === "r2_cleanup_queue") {
            return { insert: queueInsertMock };
          }
          return createChainableMock(null);
        },
      });

      mockDeleteObject.mockRejectedValue(new Error("R2 network timeout"));

      const res = await deleteContractFile(fileId, orgId, adminEmail);
      expect(res.ok).toBe(true);
      expect(queueInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          object_key: "contracts/key.pdf",
          reason: "file_deleted",
          status: "pending",
        }),
      );
    });
  });

  describe("[P2] completeUpload: Xử lý lỗi DB và xóa bù object mồ côi", () => {
    it("khi DB insert thất bại và hàng chưa ghi, xóa bù object trên R2", async () => {
      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          if (table === "contract_files") {
            return createChainableMock(null, { message: "insert failed", code: "23505" });
          }
          return createChainableMock(null);
        },
      });

      // Admin client kiểm tra DB: hàng không tồn tại
      mockCreateAdminClient.mockReturnValue({
        from: () => createChainableMock(null),
      });

      mockHeadObject.mockResolvedValue({
        exists: true,
        contentLength: 1024,
        etag: "etag-123",
      });

      mockDeleteObject.mockResolvedValue(undefined);

      const res = await completeUpload({
        organizationId: orgId,
        userId: "user-1",
        userEmail: nonAdminEmail,
        contractId,
        fileId,
        objectKey,
        filename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      });

      expect(res.ok).toBe(false);
      expect(mockDeleteObject).toHaveBeenCalledWith(objectKey);
    });

    it("khi DB insert báo lỗi nhưng hàng thực tế ĐÃ commit, KHÔNG xóa object R2", async () => {
      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          if (table === "contract_files") {
            return createChainableMock(null, { message: "socket hang up", code: "ECONNRESET" });
          }
          return createChainableMock(null);
        },
      });

      // Admin client kiểm tra DB: hàng THỰC TẾ ĐÃ ĐƯỢC COMMIT!
      mockCreateAdminClient.mockReturnValue({
        from: () => createChainableMock({ id: fileId }),
      });

      mockHeadObject.mockResolvedValue({
        exists: true,
        contentLength: 1024,
        etag: "etag-123",
      });

      const res = await completeUpload({
        organizationId: orgId,
        userId: "user-1",
        userEmail: nonAdminEmail,
        contractId,
        fileId,
        objectKey,
        filename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      });

      expect(res.ok).toBe(false);
      // Object không được xoá bù vì hàng DB đã tồn tại
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });
  });

  describe("[P2] storage-cleanup service", () => {
    it("enqueueR2Cleanup ghi nhận tác vụ vào bảng r2_cleanup_queue", async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      mockCreateAdminClient.mockReturnValue({
        from: () => ({ insert: mockInsert }),
      });

      await enqueueR2Cleanup({
        objectKey: "test-key.pdf",
        reason: "file_deleted",
        lastError: "Timeout",
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          object_key: "test-key.pdf",
          reason: "file_deleted",
          status: "pending",
          last_error: "Timeout",
        }),
      );
    });

    it("processR2CleanupQueue: hủy tác vụ nếu object upload_db_failed đang được contract_files trỏ tới", async () => {
      const mockJobs = [
        {
          id: "job-1",
          object_key: "in-use.pdf",
          reason: "upload_db_failed",
          attempts: 0,
          status: "pending",
        },
      ];

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockCreateAdminClient.mockReturnValue({
        from: (table: string) => {
          if (table === "r2_cleanup_queue") {
            const chain = createChainableMock(mockJobs);
            chain.update = mockUpdate;
            return chain;
          }
          if (table === "contract_files") {
            // Tệp đang được dùng bởi hợp đồng
            return createChainableMock({ id: "file-existing" });
          }
          return createChainableMock(null);
        },
      });

      const result = await processR2CleanupQueue();
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      // Không được gọi deleteObject trên R2
      expect(mockDeleteObject).not.toHaveBeenCalled();
      // Job phải được đánh dấu cancelled
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "cancelled",
        }),
      );
    });

    it("processR2CleanupQueue: xóa object R2 và đánh dấu completed khi hợp lệ", async () => {
      const mockJobs = [
        {
          id: "job-2",
          object_key: "orphan.pdf",
          reason: "file_deleted",
          attempts: 0,
          status: "pending",
        },
      ];

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockCreateAdminClient.mockReturnValue({
        from: (table: string) => {
          if (table === "r2_cleanup_queue") {
            const chain = createChainableMock(mockJobs);
            chain.update = mockUpdate;
            return chain;
          }
          return createChainableMock(null);
        },
      });

      mockDeleteObject.mockResolvedValue(undefined);

      const result = await processR2CleanupQueue();
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(mockDeleteObject).toHaveBeenCalledWith("orphan.pdf");
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "completed",
        }),
      );
    });
  });

  describe("[P2] createUploadRequest ràng buộc fileSize vào URL presign", () => {
    it("truyền fileSize vào createUploadUrl", async () => {
      mockCreateClient.mockReturnValue({
        from: () => createChainableMock({ id: contractId, archived_at: null }),
      });

      mockCreateUploadUrl.mockResolvedValue("https://r2.example.com/presigned-upload");

      const res = await createUploadRequest({
        organizationId: orgId,
        contractId,
        filename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 2048,
        userEmail: nonAdminEmail,
      });

      expect(res.ok).toBe(true);
      expect(mockCreateUploadUrl).toHaveBeenCalledWith(
        expect.stringContaining("test.pdf"),
        "application/pdf",
        2048,
      );
    });
  });

  describe("[P2] guardFileApiRequest: Fail-closed khi rate limit counter lỗi", () => {
    it("trả về 503 khi consumeRateLimit thất bại", async () => {
      mockResolveAccess.mockResolvedValue({
        status: "ok",
        user: {
          id: "user-1",
          email: "test@hrpartner.vn",
          role: "user",
          organizationId: orgId,
        },
      });

      mockConsumeRateLimit.mockResolvedValue({
        ok: false,
        code: "db_error",
        message: "RPC counter failure",
      });

      const guard = await guardFileApiRequest("ai:upload-url");
      expect(guard.ok).toBe(false);
      if (!guard.ok) {
        expect(guard.response.status).toBe(503);
        const data = await guard.response.json();
        expect(data.code).toBe("rate_limit_unavailable");
      }
    });
  });
});
