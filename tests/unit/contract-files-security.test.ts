import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockRpc = vi.fn();
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
  chain.abortSignal = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: resolvedData, error });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData, error });
  chain.then = (resolve: (val: unknown) => void) => resolve({ data: resolvedData, error });
  return chain;
}

function createRpcMock(data: unknown, error: unknown = null) {
  const chain = {
    abortSignal: vi.fn().mockReturnThis(),
    then: (resolve: (val: unknown) => void) => resolve({ data, error }),
  };
  return chain;
}

function createAdminMock(from: (table: string) => unknown) {
  return {
    from,
    rpc: (...args: unknown[]) => mockRpc(...args),
  };
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
    mockRpc.mockReset();
    mockRpc.mockImplementation(() => createRpcMock(null));
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

    it("không xóa R2 nếu transaction xóa DB/outbox thất bại", async () => {
      mockCreateAdminClient.mockReturnValue(
        createAdminMock((table) => {
          if (table === "contract_files") {
            return createChainableMock({
              id: fileId,
              contract_id: contractId,
              object_key: objectKey,
              organization_id: orgId,
              original_filename: "doc.pdf",
            });
          }
          if (table === "contracts") return createChainableMock({ id: contractId, archived_at: null });
          return createChainableMock(null);
        }),
      );
      mockRpc.mockImplementationOnce(() => createRpcMock(null, { message: "database error", code: "42501" }));

      const res = await deleteContractFile(fileId, orgId, adminEmail);
      expect(res.ok).toBe(false);
      expect(mockRpc).toHaveBeenCalledWith("delete_contract_file_with_cleanup", {
        p_file_id: fileId,
        p_organization_id: orgId,
        p_object_key: objectKey,
      });
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("xóa R2 sau khi xóa DB thành công bằng service-role client", async () => {
      mockCreateAdminClient.mockReturnValue(createAdminMock((table: string) => {
          if (table === "contract_files") {
            return createChainableMock({
              id: fileId,
              contract_id: contractId,
              object_key: objectKey,
              organization_id: orgId,
              original_filename: "doc.pdf",
            });
          }
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          return createChainableMock(null);
        }));

      mockDeleteObject.mockResolvedValue(undefined);
      mockRpc
        .mockImplementationOnce(() => createRpcMock({ id: fileId, contract_id: contractId, object_key: objectKey, cleanup_id: "job-1" }))
        .mockImplementationOnce(() => createRpcMock(true));

      const res = await deleteContractFile(fileId, orgId, adminEmail);
      expect(res.ok).toBe(true);
      expect(mockRpc).toHaveBeenNthCalledWith(1, "delete_contract_file_with_cleanup", expect.any(Object));
      expect(mockDeleteObject).toHaveBeenCalledWith(objectKey, { timeoutMs: 3_000 });
      expect(mockRpc).toHaveBeenNthCalledWith(2, "finish_r2_cleanup_job", {
        p_job_id: "job-1",
        p_succeeded: true,
        p_last_error: null,
      });
    });

    it("nếu xóa R2 thất bại sau khi xóa DB, đưa vào hàng đợi r2_cleanup_queue", async () => {
      mockCreateAdminClient.mockReturnValue(createAdminMock((table: string) => {
          if (table === "contract_files") {
            return createChainableMock({
              id: fileId,
              contract_id: contractId,
              object_key: objectKey,
              organization_id: orgId,
              original_filename: "doc.pdf",
            });
          }
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          return createChainableMock(null);
        }));

      mockDeleteObject.mockRejectedValue(new Error("R2 network timeout"));
      mockRpc
        .mockImplementationOnce(() => createRpcMock({ id: fileId, contract_id: contractId, object_key: objectKey, cleanup_id: "job-2" }))
        .mockImplementationOnce(() => createRpcMock(true));

      const res = await deleteContractFile(fileId, orgId, adminEmail);
      expect(res.ok).toBe(true);
      expect(mockRpc).toHaveBeenNthCalledWith(1, "delete_contract_file_with_cleanup", expect.any(Object));
      expect(mockRpc).toHaveBeenNthCalledWith(2, "finish_r2_cleanup_job", {
        p_job_id: "job-2",
        p_succeeded: false,
        p_last_error: "R2 network timeout",
      });
    });
  });

  describe("[P1] completeUpload: ghi hàng và khóa cleanup nguyên tử", () => {
    it("khi RPC ghi hàng thất bại và hàng chưa tồn tại, enqueue cleanup dưới advisory lock", async () => {
      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          return createChainableMock(null);
        },
        rpc: (...args: unknown[]) => mockRpc(...args),
      });

      mockCreateAdminClient.mockReturnValue(createAdminMock(() => createChainableMock(null)));
      mockRpc
        .mockImplementationOnce(() => createRpcMock(null, { message: "insert failed", code: "23505" }))
        .mockImplementationOnce(() => createRpcMock(true));

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
      expect(mockDeleteObject).not.toHaveBeenCalled();
      expect(mockRpc).toHaveBeenNthCalledWith(1, "complete_contract_file_upload", expect.objectContaining({
        p_object_key: objectKey,
        p_bucket: "mock-bucket",
      }));
      expect(mockRpc).toHaveBeenNthCalledWith(2, "enqueue_r2_cleanup_if_unreferenced", expect.objectContaining({
        p_object_key: objectKey,
        p_reason: "upload_db_failed",
      }));
    });

    it("khi RPC lỗi sau commit, trả lại hàng đã tồn tại thay vì dọn object", async () => {
      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          return createChainableMock(null);
        },
        rpc: (...args: unknown[]) => mockRpc(...args),
      });

      // Admin client kiểm tra DB: hàng THỰC TẾ ĐÃ ĐƯỢC COMMIT!
      mockCreateAdminClient.mockReturnValue(createAdminMock(() => createChainableMock({
        id: fileId,
        organization_id: orgId,
        contract_id: contractId,
        object_key: objectKey,
        original_filename: "test.pdf",
        mime_type: "application/pdf",
        file_size: 1024,
        checksum: "etag-123",
        created_by: "user-1",
        kind: "document",
        storage_provider: "r2",
        bucket: "mock-bucket",
        created_at: "2026-10-19T00:00:00Z",
      })));
      mockRpc.mockImplementationOnce(() => createRpcMock(null, { message: "socket hang up", code: "ECONNRESET" }));

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

      expect(res.ok).toBe(true);
      // Object không được dọn vì hàng DB đã tồn tại
      expect(mockDeleteObject).not.toHaveBeenCalled();
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });

    it("khi DB insert báo lỗi và truy vấn xác minh DB cũng lỗi, KHÔNG xóa object R2 và đưa vào hàng đợi outbox", async () => {
      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          return createChainableMock(null);
        },
        rpc: (...args: unknown[]) => mockRpc(...args),
      });

      // Admin client kiểm tra DB: TRUY VẤN XÁC MINH CŨNG BỊ LỖI
      mockCreateAdminClient.mockReturnValue(createAdminMock((table: string) => {
        if (table === "contract_files") {
          return createChainableMock(null, { message: "DB timeout", code: "57P01" });
        }
        return createChainableMock(null);
      }));
      mockRpc
        .mockImplementationOnce(() => createRpcMock(null, { message: "connection error", code: "ECONNRESET" }))
        .mockImplementationOnce(() => createRpcMock(true));

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
      // TUYỆT ĐỐI KHÔNG XÓA R2 khi trạng thái DB chưa rõ!
      expect(mockDeleteObject).not.toHaveBeenCalled();
      // Đưa vào queue bằng RPC khóa cùng key trước khi worker xử lý
      expect(mockRpc).toHaveBeenNthCalledWith(2, "enqueue_r2_cleanup_if_unreferenced", expect.objectContaining({
        p_object_key: objectKey,
        p_reason: "upload_db_failed",
      }));
    });
  });

  describe("[P2] storage-cleanup service", () => {
    it("enqueueR2Cleanup ghi nhận tác vụ vào bảng r2_cleanup_queue", async () => {
      mockCreateAdminClient.mockReturnValue(createAdminMock(() => createChainableMock(null)));
      mockRpc.mockImplementationOnce(() => createRpcMock(true));

      const success = await enqueueR2Cleanup({
        objectKey: "test-key.pdf",
        reason: "upload_db_failed",
        lastError: "Timeout",
      });

      expect(success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("enqueue_r2_cleanup_if_unreferenced", {
        p_object_key: "test-key.pdf",
        p_reason: "upload_db_failed",
        p_last_error: "Timeout",
      });
    });

    it("enqueueR2Cleanup ghi nhận lỗi khi PostgREST trả về error", async () => {
      mockCreateAdminClient.mockReturnValue(createAdminMock(() => createChainableMock(null)));
      mockRpc.mockImplementationOnce(() => createRpcMock(null, { message: "permission denied" }));

      const success = await enqueueR2Cleanup({
        objectKey: "test-key.pdf",
        reason: "upload_db_failed",
      });

      expect(success).toBe(false);
    });

    it("processR2CleanupQueue: hủy mọi loại job nếu object đang được contract_files trỏ tới", async () => {
      const mockJobs = [
        {
          id: "job-1",
          object_key: "in-use.pdf",
          attempts: 0,
          created_at: "2026-10-18T00:00:00.000Z",
        },
      ];

      mockCreateAdminClient.mockReturnValue(createAdminMock(() => createChainableMock(mockJobs)));
      mockRpc.mockImplementationOnce(() => createRpcMock({ status: "cancelled" }));

      const result = await processR2CleanupQueue();
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      // Không được gọi deleteObject trên R2
      expect(mockDeleteObject).not.toHaveBeenCalled();
      expect(mockRpc).toHaveBeenCalledWith("claim_r2_cleanup_job", expect.objectContaining({ p_job_id: "job-1" }));
    });

    it("processR2CleanupQueue: xóa object R2 và đánh dấu completed khi hợp lệ", async () => {
      const mockJobs = [
        {
          id: "job-2",
          object_key: "orphan.pdf",
          attempts: 0,
          created_at: "2026-10-18T00:00:00.000Z",
        },
      ];

      mockCreateAdminClient.mockReturnValue(createAdminMock(() => createChainableMock(mockJobs)));
      mockRpc
        .mockImplementationOnce(() => createRpcMock({ status: "claimed", object_key: "orphan.pdf" }))
        .mockImplementationOnce(() => createRpcMock(true));

      mockDeleteObject.mockResolvedValue(undefined);

      const result = await processR2CleanupQueue();
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(mockDeleteObject).toHaveBeenCalledWith("orphan.pdf", { timeoutMs: 4_000 });
      expect(mockRpc).toHaveBeenNthCalledWith(2, "finish_r2_cleanup_job", expect.objectContaining({
        p_job_id: "job-2",
        p_succeeded: true,
      }));
    });

    it("processR2CleanupQueue: không xóa R2 nếu transaction claim/đối soát DB gặp lỗi", async () => {
      const mockJobs = [
        {
          id: "job-err",
          object_key: "uncertain.pdf",
          attempts: 0,
          created_at: "2026-10-18T00:00:00.000Z",
        },
      ];

      mockCreateAdminClient.mockReturnValue(createAdminMock(() => createChainableMock(mockJobs)));
      mockRpc.mockImplementationOnce(() => createRpcMock(null, { message: "DB verification error" }));

      const result = await processR2CleanupQueue();
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.succeeded).toBe(0);
      // KHÔNG được xóa R2 vì lỗi truy vấn đối soát
      expect(mockDeleteObject).not.toHaveBeenCalled();
      expect(mockRpc).toHaveBeenCalledTimes(1);
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

    it("createUploadRequest: từ chối tạo presigned url cho phụ lục khi hợp đồng chưa có tài liệu chính", async () => {
      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          // table === "contract_files": không có file kind = "document" nào
          return createChainableMock(null, null);
        },
      });

      const res = await createUploadRequest({
        organizationId: orgId,
        contractId,
        filename: "phu-luc-1.pdf",
        mimeType: "application/pdf",
        fileSize: 2048,
        kind: "appendix",
        userEmail: nonAdminEmail,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("validation");
        expect(res.message).toContain("Cần tải tệp hợp đồng chính lên trước khi tải phụ lục");
      }
    });

    it("createUploadRequest: cho phép tạo presigned url cho phụ lục khi hợp đồng đã có tài liệu chính", async () => {
      mockCreateClient.mockReturnValue({
        from: (table: string) => {
          if (table === "contracts") {
            return createChainableMock({ id: contractId, archived_at: null });
          }
          // table === "contract_files": có file document
          return createChainableMock({ id: "doc-1" }, null);
        },
      });

      mockCreateUploadUrl.mockResolvedValue("https://r2.example.com/presigned-appendix");

      const res = await createUploadRequest({
        organizationId: orgId,
        contractId,
        filename: "phu-luc-1.pdf",
        mimeType: "application/pdf",
        fileSize: 2048,
        kind: "appendix",
        userEmail: nonAdminEmail,
      });

      expect(res.ok).toBe(true);
      expect(mockCreateUploadUrl).toHaveBeenCalledWith(
        expect.stringContaining("phu-luc-1.pdf"),
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
