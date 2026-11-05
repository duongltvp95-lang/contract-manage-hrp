import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), createAdminClient: vi.fn(), currentUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/services/audit-logs", () => ({ recordCurrentUserAudit: vi.fn() }));
import { deletePartner, deletePartners, updatePartner } from "@/lib/services/partners";
import { deleteContract, deleteContracts, listContracts, unarchiveContract } from "@/lib/services/contracts";
import { countNoFileContracts } from "@/lib/services/dashboard";
import { deleteContractFile } from "@/lib/services/files";
import { getOrganization } from "@/lib/services/organizations";
import { deleteUser, updateUser } from "@/lib/services/users";
import { DEFAULT_QUERY } from "@/lib/contracts-query";

const org = "11111111-1111-1111-1111-111111111111";
const target = "cccccccc-0000-4000-8000-000000000001";
function query(data: unknown, error: unknown = null, count = 0) {
  const q = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error, count }),
  };
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({
    id: "aaaaaaaa-0000-4000-8000-000000000001", email: "admin@test.invalid",
    organizationId: org, role: "admin", fullName: "Test", accentColor: null, backgroundColor: null, sidebarColor: null,
  });
});
describe("review service regressions", () => {
  it.each([
    ["update user", () => updateUser({ userId: target, isActive: false }, "admin")],
    ["delete user", () => deleteUser({ userId: target, confirmEmail: "other@test.invalid" }, "admin")],
    ["delete contract", () => deleteContract(target, { organizationId: org })],
    ["bulk delete contracts", () => deleteContracts([target], { organizationId: org })],
    ["unarchive contract", () => unarchiveContract(target)],
    ["delete partner", () => deletePartner(target, { organizationId: org })],
    ["bulk delete partners", () => deletePartners([target], { organizationId: org })],
    ["delete file", () => deleteContractFile(target, org, "regular@test.invalid")],
  ] as const)("still blocks an unauthorized user before privileged I/O: %s", async (_, operation) => {
    mocks.currentUser.mockResolvedValue({ id: target, email: "regular@test.invalid", organizationId: org, role: "user" });
    const result = await operation();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each(["update", "delete"])("blocks %s of another tenant's user before Auth calls", async (operation) => {
    const auth = { getUserById: vi.fn(), deleteUser: vi.fn() };
    mocks.createAdminClient.mockReturnValue({
      from: () => query({ id: target, organization_id: "22222222-2222-2222-2222-222222222222", role: "user", is_active: true }),
      auth: { admin: auth },
    });
    const result = operation === "update"
      ? await updateUser({ userId: target, isActive: false }, "admin")
      : await deleteUser({ userId: target, confirmEmail: "other@test.invalid" }, "admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
    expect(auth.getUserById).not.toHaveBeenCalled();
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });
  it("uses an atomic partner RPC and never issues a separate delete on failure", async () => {
    const from = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000" } });
    mocks.createClient.mockResolvedValue({ from, rpc });
    const result = await updatePartner(target, {
      name: "Changed", companyIds: ["00000000-0000-4000-8000-000000000001"],
    }, { organizationId: org });
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("update_partner_atomic", expect.objectContaining({ p_organization_id: org }));
  });
  it("filters missing files in SQL and searches joined partner names", async () => {
    const q = query([{ id: target, partner_name: "Shared partner", company_name: "HRP", file_count: 0 }], null, 1501);
    const from = vi.fn().mockReturnValue(q);
    mocks.createClient.mockResolvedValue({ from });
    const result = await listContracts({ organizationId: org, query: { ...DEFAULT_QUERY, q: "Shared" }, scope: "no-files" });
    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("contract_listing");
    expect(q.eq).toHaveBeenCalledWith("has_files", false);
    expect(q.or).toHaveBeenCalledWith(expect.stringContaining("partner_name.ilike.%Shared%"));
    expect(result.ok && result.data.total).toBe(1501);
  });
  it("counts missing files without fetching an ID list, and propagates DB failures", async () => {
    const q = query(null, { code: "XX000" });
    mocks.createClient.mockResolvedValue({ from: () => q });
    expect((await countNoFileContracts(org)).ok).toBe(false);
    expect(q.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(q.eq).toHaveBeenCalledWith("has_files", false);
  });
  it("returns organization MST 2500754513 in OrganizationSummary", async () => {
    const q = query({ id: org, name: "HR Partner", created_at: "2026-10-03T00:00:00.000Z" });
    mocks.createClient.mockResolvedValue({ from: () => q });
    const result = await getOrganization(org);
    expect(result).toEqual({
      ok: true,
      data: {
        id: org,
        name: "HR Partner",
        taxCode: "2500754513",
        createdAt: "2026-10-03T00:00:00.000Z",
      },
    });
  });
});
