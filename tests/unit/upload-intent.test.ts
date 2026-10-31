import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), presign: vi.fn() }));
const org = "11111111-1111-1111-1111-111111111111";
const contract = "cccccccc-0000-4000-8000-000000000001";
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: { id: "contract", archived_at: null }, error: null }),
    }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/r2/client", () => ({ getR2Bucket: () => "test-bucket" }));
vi.mock("@/lib/r2/presign", () => ({
  createUploadUrl: mocks.presign, createViewUrl: vi.fn(), VIEW_URL_TTL_SECONDS: 900,
}));
vi.mock("@/lib/services/audit-logs", () => ({ recordCurrentUserAudit: vi.fn() }));
import { createUploadRequest } from "@/lib/services/files";
const input = { userId: "aaaaaaaa-0000-4000-8000-000000000001", organizationId: org,
  contractId: contract, filename: "document.pdf", mimeType: "application/pdf", fileSize: 100 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("UPLOAD_RESERVATION_SECRET", "test-upload-reservation-secret");
  mocks.presign.mockResolvedValue("https://r2.test.invalid/upload");
});
afterEach(() => vi.unstubAllEnvs());
describe("durable upload intent", () => {
  it.each([
    { data: null, error: { code: "XX000" } },
    { data: false, error: null },
  ])("does not issue a PUT URL when registration fails: %j", async (result) => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => result });
    expect((await createUploadRequest(input)).ok).toBe(false);
    expect(mocks.presign).not.toHaveBeenCalled();
  });
  it("registers an uncommitted upload before issuing its signed URL", async () => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: true, error: null }) });
    expect((await createUploadRequest(input)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("register_contract_upload_intent", expect.objectContaining({
      p_organization_id: org, p_contract_id: contract, p_created_by: input.userId,
    }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.presign.mock.invocationCallOrder[0]);
  });
});
