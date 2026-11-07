import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
  resolveAccess: vi.fn(),
}));

const supabaseAdminMocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

const supabaseServerMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

const auditRecordMocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  recordCurrentUserAudit: vi.fn(),
}));

const r2ObjectsMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getObjectBuffer: vi.fn(),
}));

const cleanupQueueMocks = vi.hoisted(() => ({
  enqueueR2Cleanup: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: authMocks.getCurrentUser,
  requireUser: authMocks.requireUser,
  resolveAccess: authMocks.resolveAccess,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: supabaseAdminMocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: supabaseServerMocks.createClient,
}));

vi.mock("@/lib/r2/objects", () => ({
  deleteObject: r2ObjectsMocks.deleteObject,
  getObjectBuffer: r2ObjectsMocks.getObjectBuffer,
}));

vi.mock("@/lib/services/storage-cleanup", () => ({
  enqueueR2Cleanup: cleanupQueueMocks.enqueueR2Cleanup,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { cleanupAiTempObjectAction } from "@/app/(app)/contracts/actions";
import { buildAiTempObjectKey } from "@/lib/r2/keys";
import { exportAuditLogs, recordAudit } from "@/lib/services/audit-logs";
import {
  listPartners,
  listPartnersDirectoryPage,
  previewPartnerImport,
} from "@/lib/services/partners";
import { createAiUploadSession } from "@/lib/services/upload-reservation";
import { deleteUser, resetTombstoneProfileCache } from "@/lib/services/users";
import { evaluateLifecycleRules } from "../../scripts/setup-r2-lifecycle.mjs";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const VICTIM_ID = "aaaaaaaa-0000-4000-8000-000000000002";
const TOMBSTONE_ID = "aaaaaaaa-0000-4000-8000-000000000099";
const FILE_ID = "33333333-3333-4333-8333-333333333333";

describe("Audit Wave 2 unit suite (A06, A08, A10, A12)", () => {
  const prevSecret = process.env.UPLOAD_RESERVATION_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTombstoneProfileCache();
    process.env.UPLOAD_RESERVATION_SECRET = "wave2-test-secret";
    const mockUser = {
      id: ADMIN_ID,
      email: "admin@hrp.test",
      fullName: "Admin HRP",
      role: "admin" as const,
      isActive: true,
      organizationId: ORG_ID,
      canManageArchived: true,
    };
    authMocks.getCurrentUser.mockResolvedValue(mockUser);
    authMocks.resolveAccess.mockResolvedValue({ status: "ok", user: mockUser });
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.UPLOAD_RESERVATION_SECRET;
    else process.env.UPLOAD_RESERVATION_SECRET = prevSecret;
  });

  describe("A06 — deleteUser rollback & post-GoTrue audit ordering", () => {
    function buildDeleteUserServiceMock(options: {
      deleteAuthResult: { error: unknown };
      rpcCalls: Array<{ fnName: string; args?: unknown }>;
      profileDeleteSpy: () => void;
    }) {
      const rpcMock = vi.fn((fnName: string, args?: unknown) => {
        options.rpcCalls.push({ fnName, args });
        const resultPromise = Promise.resolve({
          data:
            fnName === "enqueue_audit_event"
              ? { id: (args as { p_id?: string } | undefined)?.p_id ?? "evt-1" }
              : 1,
          error: null,
        });
        return Object.assign(resultPromise, {
          abortSignal: () => resultPromise,
        });
      });
      return {
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            const state: Record<string, unknown> = {};
            const chain = {
              select: vi.fn(() => chain),
              eq: vi.fn((col: string, val: unknown) => {
                state[col] = val;
                return chain;
              }),
              order: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              delete: vi.fn(() => {
                options.profileDeleteSpy();
                return chain;
              }),
              maybeSingle: vi.fn(async () => {
                if (state.is_tombstone === true) {
                  return { data: { id: TOMBSTONE_ID }, error: null };
                }
                return {
                  data: {
                    id: VICTIM_ID,
                    full_name: "Nhân sự Bị Xoá",
                    role: "user",
                    is_active: true,
                    created_at: "2026-01-01T00:00:00Z",
                    organization_id: ORG_ID,
                  },
                  error: null,
                };
              }),
              then: (resolve: (val: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(resolve),
            };
            return chain;
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        rpc: rpcMock,
        auth: {
          admin: {
            getUserById: vi.fn(async () => ({
              data: { user: { id: VICTIM_ID, email: "victim@hrp.test" } },
              error: null,
            })),
            deleteUser: vi.fn(async () => options.deleteAuthResult),
          },
        },
      };
    }

    it("rolls back re-pointed audit rows and skips delete_user audit when GoTrue delete fails", async () => {
      const rpcCalls: Array<{ fnName: string; args?: unknown }> = [];
      const profileDeleteSpy = vi.fn();

      supabaseAdminMocks.createAdminClient.mockReturnValue(
        buildDeleteUserServiceMock({
          deleteAuthResult: { error: { status: 503, message: "GoTrue unavailable" } },
          rpcCalls,
          profileDeleteSpy,
        }),
      );

      const res = await deleteUser(
        { userId: VICTIM_ID, confirmEmail: "victim@hrp.test" },
        ADMIN_ID,
      );

      expect(res.ok).toBe(false);
      expect(rpcCalls).toEqual([
        {
          fnName: "prepare_actor_audit_for_user_delete",
          args: {
            p_organization_id: ORG_ID,
            p_user_id: VICTIM_ID,
            p_tombstone_id: TOMBSTONE_ID,
            p_actor_name: "Nhân sự Bị Xoá",
            p_actor_email: "victim@hrp.test",
          },
        },
        {
          fnName: "restore_actor_audit_after_failed_user_delete",
          args: {
            p_organization_id: ORG_ID,
            p_user_id: VICTIM_ID,
            p_tombstone_id: TOMBSTONE_ID,
          },
        },
      ]);
      // Premature delete_user event must NOT be written when GoTrue rejected the delete.
      expect(rpcCalls.some((c) => c.fnName === "enqueue_audit_event")).toBe(false);
    });

    it("treats 404 User not found on retry as idempotent completion and cleans up orphaned profile", async () => {
      const rpcCalls: Array<{ fnName: string; args?: unknown }> = [];
      const profileDeleteSpy = vi.fn();

      supabaseAdminMocks.createAdminClient.mockReturnValue(
        buildDeleteUserServiceMock({
          deleteAuthResult: { error: { status: 404, message: "User not found" } },
          rpcCalls,
          profileDeleteSpy,
        }),
      );

      const res = await deleteUser(
        { userId: VICTIM_ID, confirmEmail: "victim@hrp.test" },
        ADMIN_ID,
      );

      expect(res.ok).toBe(true);
      expect(profileDeleteSpy).toHaveBeenCalledTimes(1);
      expect(rpcCalls.map((c) => c.fnName)).toEqual([
        "prepare_actor_audit_for_user_delete",
        "enqueue_audit_event",
      ]);
      void recordAudit;
      void auditRecordMocks;
    });
  });

  describe("A08 — AI temp cleanup authorization, durable queue fallback & R2 lifecycle safety", () => {
    it("rejects cleanup without a valid user-bound aiUploadToken and enqueues durable cleanup when R2 delete fails", async () => {
      const ownedKey = buildAiTempObjectKey({
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        fileId: FILE_ID,
        filename: "scan.pdf",
      });

      const forgedRes = await cleanupAiTempObjectAction(
        ownedKey,
        "forged-upload-token-invalid-hmac",
      );
      expect(forgedRes.ok).toBe(false);
      if (!forgedRes.ok) {
        expect(forgedRes.code).toBe("validation");
      }
      expect(r2ObjectsMocks.deleteObject).not.toHaveBeenCalled();

      const validToken = createAiUploadSession({
        userId: ADMIN_ID,
        organizationId: ORG_ID,
        objectKey: ownedKey,
      });

      r2ObjectsMocks.deleteObject.mockRejectedValueOnce(new Error("R2 503 SlowDown"));
      cleanupQueueMocks.enqueueR2Cleanup.mockResolvedValueOnce(true);

      const fallbackRes = await cleanupAiTempObjectAction(ownedKey, validToken);
      expect(fallbackRes).toEqual({
        ok: true,
        data: { deleted: false, queued: true },
      });
      expect(cleanupQueueMocks.enqueueR2Cleanup).toHaveBeenCalledWith({
        objectKey: ownedKey,
        reason: "reconciliation",
        lastError: "R2 503 SlowDown",
      });
    });

    it("flags dangerous empty-prefix lifecycle rules and requires both ai-temp/ and uploads-staging/ rules", () => {
      const dangerous = evaluateLifecycleRules([
        { ID: "wipe-all", Status: "Enabled", Filter: { Prefix: "" }, Expiration: { Days: 1 } },
      ]);
      expect(dangerous.ok).toBe(false);
      expect(dangerous.issues.some((msg: string) => msg.includes("CRITICAL"))).toBe(true);

      const safe = evaluateLifecycleRules([
        {
          ID: "auto-delete-ai-temp-24h",
          Status: "Enabled",
          Filter: { Prefix: "ai-temp/" },
          Expiration: { Days: 1 },
        },
        {
          ID: "auto-delete-uploads-staging-48h",
          Status: "Enabled",
          Filter: { Prefix: "uploads-staging/" },
          Expiration: { Days: 2 },
        },
      ]);
      expect(safe.ok).toBe(true);
      expect(safe.issues).toEqual([]);
    });
  });

  describe("A10 — Batched >1,000-row listPartners, page clamping, and folded import candidate lookup", () => {
    it("fetches all 1,250 partners across multiple 1,000-row RPC batches without truncation", async () => {
      const allRows = Array.from({ length: 1_250 }, (_, idx) => ({
        id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
        organization_id: ORG_ID,
        name: `Đối tác ${String(idx + 1).padStart(4, "0")}`,
        address: null,
        tax_code: null,
        region: null,
        abbreviation: null,
        status: "active" as const,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        contract_count: 0,
        companies: ["HRP"],
      }));

      const rangeCalls: Array<[number, number]> = [];
      supabaseServerMocks.createClient.mockResolvedValue({
        rpc: vi.fn(() => ({
          range: vi.fn(async (from: number, to: number) => {
            rangeCalls.push([from, to]);
            return { data: allRows.slice(from, to + 1), error: null };
          }),
        })),
      });

      const res = await listPartners({ organizationId: ORG_ID });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toHaveLength(1_250);
      }
      expect(rangeCalls).toEqual([
        [0, 999],
        [1000, 1999],
      ]);
    });

    it("clamps out-of-range page numbers in listPartnersDirectoryPage to the last available page", async () => {
      const rpcMock = vi.fn(async (_fn: string, args: { p_offset: number }) => {
        if (args.p_offset >= 100) {
          return { data: [], error: null };
        }
        return {
          data: [
            {
              id: "dddddddd-0000-4000-8000-000000000001",
              organization_id: ORG_ID,
              name: "Đối tác Trang 1",
              address: null,
              tax_code: "0101234567",
              region: "Miền Bắc",
              abbreviation: "DT1",
              status: "active",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              contract_count: 2,
              companies: ["HRP"],
              total_count: 1,
            },
          ],
          error: null,
        };
      });

      supabaseServerMocks.createClient.mockResolvedValue({ rpc: rpcMock });

      const res = await listPartnersDirectoryPage({
        organizationId: ORG_ID,
        page: 99,
        pageSize: 100,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.page).toBe(1);
        expect(res.data.totalCount).toBe(1);
        expect(res.data.rows).toHaveLength(1);
      }
    });

    it("queries folded candidate columns instead of calling get_partners_summary in previewPartnerImport", async () => {
      const rpcSpy = vi.fn();
      const inCalls: Array<{ column: string; values: unknown[] }> = [];

      supabaseServerMocks.createClient.mockResolvedValue({
        rpc: rpcSpy,
        from: vi.fn((table: string) => {
          if (table === "partners") {
            const chain = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              in: vi.fn(async (column: string, values: unknown[]) => {
                inCalls.push({ column, values });
                if (column === "name_folded") {
                  return {
                    data: [
                      {
                        id: "dddddddd-0000-4000-8000-000000000077",
                        organization_id: ORG_ID,
                        name: "Công ty Cổ phần Đăng Khoa",
                        address: null,
                        tax_code: "0109999888",
                        region: null,
                        abbreviation: null,
                        status: "active",
                        created_at: "2026-01-01T00:00:00Z",
                        updated_at: "2026-01-01T00:00:00Z",
                      },
                    ],
                    error: null,
                  };
                }
                return { data: [], error: null };
              }),
            };
            return chain;
          }
          if (table === "partner_companies") {
            const chain = {
              select: vi.fn(() => chain),
              in: vi.fn(() => chain),
              order: vi.fn(() => chain),
              range: vi.fn(async () => ({
                data: [
                  {
                    partner_id: "dddddddd-0000-4000-8000-000000000077",
                    companies: { name: "HRP" },
                  },
                ],
                error: null,
              })),
            };
            return chain;
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      });

      const preview = await previewPartnerImport(
        [
          {
            rowNumber: 2,
            name: "Cong ty Co phan Dang Khoa",
            taxCode: "",
            address: "Hà Nội",
            region: "Miền Bắc",
            abbreviation: "ĐK",
            status: "active",
            companies: ["HRP"],
            hasCompanyColumn: true,
          },
        ],
        { organizationId: ORG_ID },
      );

      expect(rpcSpy).not.toHaveBeenCalled();
      expect(inCalls).toEqual([
        { column: "name_folded", values: ["cong ty co phan dang khoa"] },
      ]);
      expect(preview.ok).toBe(true);
      if (preview.ok) {
        expect(preview.data[0]?.updated).toBe(true);
        expect(preview.data[0]?.partnerId).toBe("dddddddd-0000-4000-8000-000000000077");
      }
    });
  });

  describe("A12 — Paginated exportAuditLogs beyond 200 rows & truncation reporting", () => {
    it("paginates in 500-row batches and flags truncated=true when total exceeds maxRows", async () => {
      const dbRows = Array.from({ length: 650 }, (_, idx) => ({
        id: `88888888-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
        organization_id: ORG_ID,
        actor_id: TOMBSTONE_ID,
        deleted_actor_id: VICTIM_ID,
        actor_name_snapshot: "Nhân sự Cũ",
        actor_email_snapshot: "old@hrp.test",
        actor_role: "user",
        action: "create_contract",
        target_kind: "contract",
        target_id: null,
        metadata: {},
        created_at: "2026-06-01T00:00:00Z",
      }));

      supabaseAdminMocks.createAdminClient.mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === "audit_logs") {
            let isCountHead = false;
            const chain = {
              select: vi.fn((_cols: string, opts?: { head?: boolean }) => {
                isCountHead = Boolean(opts?.head);
                return chain;
              }),
              eq: vi.fn(() => chain),
              gte: vi.fn(() => chain),
              lt: vi.fn(() => chain),
              or: vi.fn(() => chain),
              order: vi.fn(() => chain),
              range: vi.fn(async (from: number, to: number) => ({
                data: dbRows.slice(from, to + 1),
                error: null,
              })),
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(
                  isCountHead ? { count: 650, error: null } : { data: [], error: null },
                ).then(resolve),
            };
            return chain;
          }
          if (table === "profiles") {
            return {
              select: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [{ id: TOMBSTONE_ID, full_name: "[Người dùng đã xoá]", is_tombstone: true }],
                  error: null,
                })),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        auth: {
          admin: {
            getUserById: vi.fn(),
          },
        },
      });

      const fullExport = await exportAuditLogs(ORG_ID, {});
      expect(fullExport.ok).toBe(true);
      if (fullExport.ok) {
        expect(fullExport.data.rows).toHaveLength(650);
        expect(fullExport.data.total).toBe(650);
        expect(fullExport.data.truncated).toBe(false);
        // Verifies A06 snapshot hydration on tombstoned actor rows too!
        expect(fullExport.data.rows[0]?.actorName).toBe("Nhân sự Cũ");
        expect(fullExport.data.rows[0]?.actorEmail).toBe("old@hrp.test");
        expect(fullExport.data.rows[0]?.deletedActorId).toBe(VICTIM_ID);
      }

      const cappedExport = await exportAuditLogs(ORG_ID, {}, { maxRows: 550 });
      expect(cappedExport.ok).toBe(true);
      if (cappedExport.ok) {
        expect(cappedExport.data.rows).toHaveLength(550);
        expect(cappedExport.data.total).toBe(650);
        expect(cappedExport.data.truncated).toBe(true);
      }
    });
  });
});
