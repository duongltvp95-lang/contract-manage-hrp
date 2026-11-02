import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCurrentUser = vi.fn();
const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockRecordAudit = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => mockGetCurrentUser() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => mockCreateClient() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mockCreateAdminClient() }));
vi.mock("@/lib/services/audit-logs", () => ({ recordCurrentUserAudit: (...args: unknown[]) => mockRecordAudit(...args) }));
vi.mock("@/lib/services/partners", () => ({ getCompany: vi.fn(), getPartner: vi.fn() }));

import { OWNER_EMAIL } from "@/lib/owner";
import { deleteContract } from "@/lib/services/contracts";

function createQuery(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn().mockReturnValue(query);
  query.eq = vi.fn().mockReturnValue(query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return query;
}

function createRpcResult(data: unknown, error: unknown = null) {
  return {
    abortSignal: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

describe("deleteContract transactional R2 cleanup outbox", () => {
  const contractId = "22222222-2222-2222-2222-222222222222";
  const organizationId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ id: "owner-1", email: OWNER_EMAIL });
    mockCreateClient.mockReturnValue({
      from: () => createQuery({
        id: contractId,
        organization_id: organizationId,
        contract_number: "HD-1",
        partner_name: "Partner",
        partners: null,
        companies: null,
      }),
    });
    mockRpc.mockImplementation(() => createRpcResult({ id: contractId, files_queued: 2 }));
    mockCreateAdminClient.mockReturnValue({ rpc: (...args: unknown[]) => mockRpc(...args) });
    mockRecordAudit.mockResolvedValue({ ok: true });
  });

  it("deletes contract through one service-role RPC that queues file cleanup atomically", async () => {
    const result = await deleteContract(contractId, { organizationId });

    expect(result).toEqual({ ok: true, data: { id: contractId } });
    expect(mockRpc).toHaveBeenCalledWith("delete_contract_with_r2_cleanup", {
      p_contract_id: contractId,
      p_organization_id: organizationId,
    });
    expect(mockRecordAudit).toHaveBeenCalledOnce();
  });

  it("reports database failure without attempting an R2-first delete", async () => {
    mockRpc.mockImplementationOnce(() => createRpcResult(null, { message: "transaction failed", code: "XX000" }));

    const result = await deleteContract(contractId, { organizationId });

    expect(result.ok).toBe(false);
    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
