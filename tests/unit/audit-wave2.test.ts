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
import {
  buildR2CopyProbeKeys,
  cleanupAndVerifyR2ProbeKeys,
  isCloudflareR2EndpointUrl,
} from "../../scripts/verify-r2-conditional-copy.mjs";

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

      // Regression: sub-prefix under contracts/ (e.g. contracts/example-tenant/) MUST fail!
      const subPrefixOverlap = evaluateLifecycleRules([
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
        {
          ID: "tenant-subprefix-danger",
          Status: "Enabled",
          Filter: { Prefix: "contracts/example-tenant/" },
          Expiration: { Days: 30 },
        },
      ]);
      expect(subPrefixOverlap.ok).toBe(false);
      expect(
        subPrefixOverlap.issues.some((msg: string) =>
          msg.includes("CRITICAL") && msg.includes("contracts/example-tenant/"),
        ),
      ).toBe(true);

      // Unexpected expiration prefix outside ai-temp/ and uploads-staging/ MUST also fail!
      const unexpectedPrefix = evaluateLifecycleRules([
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
        {
          ID: "stray-expiration",
          Status: "Enabled",
          Filter: { And: { Prefix: "misc-prefix/" } },
          Expiration: { Days: 7 },
        },
      ]);
      expect(unexpectedPrefix.ok).toBe(false);
      expect(
        unexpectedPrefix.issues.some((msg: string) =>
          msg.includes("CRITICAL") && msg.includes("misc-prefix/"),
        ),
      ).toBe(true);

      // Regression: short expiration (< 2 days) or Date-based expiration on an
      // uploads-staging/* sub-prefix (e.g. uploads-staging/example-tenant/) MUST fail!
      const shortStagingSubPrefix = evaluateLifecycleRules([
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
        {
          ID: "tenant-staging-1d-too-short",
          Status: "Enabled",
          Filter: { Prefix: "uploads-staging/example-tenant/" },
          Expiration: { Days: 1 },
        },
      ]);
      expect(shortStagingSubPrefix.ok).toBe(false);
      expect(
        shortStagingSubPrefix.issues.some((msg: string) =>
          msg.includes("uploads-staging/example-tenant/") && msg.includes(">= 2 days"),
        ),
      ).toBe(true);

      const dateBasedSubPrefix = evaluateLifecycleRules([
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
        {
          ID: "date-based-ai-temp-subprefix",
          Status: "Enabled",
          Filter: { Prefix: "ai-temp/tenant/" },
          Expiration: { Date: "2026-12-01T00:00:00Z" } as unknown as { Days: number },
        },
      ]);
      expect(dateBasedSubPrefix.ok).toBe(false);

      // A sub-prefix rule alone must NOT satisfy bucket-wide uploads-staging/ coverage
      const subPrefixOnlyStaging = evaluateLifecycleRules([
        {
          ID: "auto-delete-ai-temp-24h",
          Status: "Enabled",
          Filter: { Prefix: "ai-temp/" },
          Expiration: { Days: 1 },
        },
        {
          ID: "only-one-tenant-staging",
          Status: "Enabled",
          Filter: { Prefix: "uploads-staging/example-tenant/" },
          Expiration: { Days: 2 },
        },
      ]);
      expect(subPrefixOnlyStaging.ok).toBe(false);
      expect(subPrefixOnlyStaging.hasUploadsStagingRule).toBe(false);

      // R2 conditional CopyObject probe helper safety: never writes under contracts/
      const probeKeys = buildR2CopyProbeKeys("probe-123");
      expect(probeKeys.prefix).toBe("uploads-staging/_r2-copy-probe-probe-123");
      for (const key of [
        probeKeys.sourceA,
        probeKeys.sourceB,
        probeKeys.dest,
        probeKeys.destMismatch,
      ]) {
        expect(key.startsWith("uploads-staging/")).toBe(true);
        expect(key.startsWith("contracts/")).toBe(false);
      }
      expect(isCloudflareR2EndpointUrl("https://abc.r2.cloudflarestorage.com")).toBe(true);
      expect(isCloudflareR2EndpointUrl("https://abc.r2.cloudflarestorage.com", "isolated")).toBe(false);
      expect(isCloudflareR2EndpointUrl("http://127.0.0.1:9000")).toBe(false);
    });

    it("verifies R2 probe keys are actually absent after cleanup instead of swallowing delete errors", async () => {
      const probeKeys = buildR2CopyProbeKeys("cleanup-check");
      const keys = [probeKeys.sourceA, probeKeys.sourceB];

      // 1. Delete error must surface as ok=false
      const deleteFailed = await cleanupAndVerifyR2ProbeKeys({
        bucket: "hrp-contract",
        prefix: probeKeys.prefix,
        keys,
        send: async (cmd: unknown) => {
          const name = (cmd as { constructor?: { name?: string } })?.constructor?.name;
          if (name === "DeleteObjectCommand") {
            throw new Error("AccessDenied on DeleteObject");
          }
          if (name === "HeadObjectCommand") {
            throw Object.assign(new Error("NotFound"), {
              name: "NotFound",
              $metadata: { httpStatusCode: 404 },
            });
          }
          return { Contents: [] };
        },
      });
      expect(deleteFailed.ok).toBe(false);
      expect(deleteFailed.deleteErrors.length).toBe(2);

      // 2. Leftover object detected via ListObjectsV2 or HEAD must surface as ok=false
      const leftover = await cleanupAndVerifyR2ProbeKeys({
        bucket: "hrp-contract",
        prefix: probeKeys.prefix,
        keys,
        send: async (cmd: unknown) => {
          const name = (cmd as { constructor?: { name?: string } })?.constructor?.name;
          if (name === "DeleteObjectCommand") return {};
          if (name === "HeadObjectCommand") {
            throw Object.assign(new Error("NotFound"), {
              name: "NotFound",
              $metadata: { httpStatusCode: 404 },
            });
          }
          return { Contents: [{ Key: probeKeys.sourceA }] };
        },
      });
      expect(leftover.ok).toBe(false);
      expect(leftover.remainingKeys).toEqual([probeKeys.sourceA]);

      // 3. Verified clean state: all deletes succeed, all HEADs return 404, LIST returns 0 objects
      const clean = await cleanupAndVerifyR2ProbeKeys({
        bucket: "hrp-contract",
        prefix: probeKeys.prefix,
        keys,
        send: async (cmd: unknown) => {
          const name = (cmd as { constructor?: { name?: string } })?.constructor?.name;
          if (name === "DeleteObjectCommand") return {};
          if (name === "HeadObjectCommand") {
            throw Object.assign(new Error("NotFound"), {
              name: "NotFound",
              $metadata: { httpStatusCode: 404 },
            });
          }
          return { Contents: [] };
        },
      });
      expect(clean).toEqual({
        ok: true,
        deletedAttempted: 2,
        remainingKeys: [],
        deleteErrors: [],
        verifyErrors: [],
      });
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
        deleted_actor_id: idx === 1 ? null : VICTIM_ID,
        actor_name_snapshot: idx === 1 ? null : "Nhân sự Cũ",
        actor_email_snapshot: idx === 1 ? null : "old@hrp.test",
        actor_role: "user",
        action: "create_contract",
        target_kind: "contract",
        target_id: null,
        metadata:
          idx === 1
            ? {
                deletedActorId: VICTIM_ID,
                actorNameSnapshot: "Nhân sự Metadata Rollback",
                actorEmailSnapshot: "rollback-meta@hrp.test",
              }
            : {},
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
        // Verifies A06 snapshot hydration on tombstoned actor rows (both typed columns & metadata rollback fallback)!
        expect(fullExport.data.rows[0]?.actorName).toBe("Nhân sự Cũ");
        expect(fullExport.data.rows[0]?.actorEmail).toBe("old@hrp.test");
        expect(fullExport.data.rows[0]?.deletedActorId).toBe(VICTIM_ID);
        expect(fullExport.data.rows[1]?.actorName).toBe("Nhân sự Metadata Rollback");
        expect(fullExport.data.rows[1]?.actorEmail).toBe("rollback-meta@hrp.test");
        expect(fullExport.data.rows[1]?.deletedActorId).toBe(VICTIM_ID);
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
