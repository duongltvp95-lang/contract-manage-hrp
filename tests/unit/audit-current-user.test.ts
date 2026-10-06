import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordCurrentUserAudit } from "@/lib/services/audit-logs";

/**
 * Round 8, part 1 — `recordCurrentUserAudit` behaviour.
 *
 * It exists so business actions can attribute an audit row to the CURRENT user
 * without ever failing the business action. These tests pin the three edges:
 * write failure is swallowed, no user is a no-op, and the happy path forwards
 * the session identity (id + role + organization) into `recordAudit`.
 */

const mockGetCurrentUser = getCurrentUser as unknown as ReturnType<typeof vi.fn>;
const mockCreateAdminClient = createAdminClient as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.restoreAllMocks();
  // Silence the server-side error logs the swallow path is expected to emit.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordCurrentUserAudit", () => {
  it("swallows a write failure and never throws", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "actor-1",
      role: "admin",
      organizationId: "org-1",
      email: null,
      fullName: null,
    });
    mockCreateAdminClient.mockRejectedValue(new Error("no service role"));

    await expect(
      recordCurrentUserAudit({
        action: "create_partner",
        targetKind: "partner",
        targetId: "target-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("does nothing when there is no current user", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    await expect(
      recordCurrentUserAudit({
        action: "create_partner",
        targetKind: "partner",
        targetId: null,
      }),
    ).resolves.toBeUndefined();

    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("forwards the session identity into the insert", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "actor-1",
      role: "user",
      organizationId: "org-1",
      email: null,
      fullName: null,
    });

    let inserted: Record<string, unknown> | undefined;

    mockCreateAdminClient.mockResolvedValue({
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          inserted = payload;
          return {
            select: () => ({
              single: async () => ({ data: { id: "row-1" }, error: null }),
            }),
          };
        },
      }),
    });

    await recordCurrentUserAudit({
      action: "update_partner",
      targetKind: "partner",
      targetId: "target-1",
      metadata: { name: "X", changed: ["name"] },
    });

    expect(inserted).toMatchObject({
      organization_id: "org-1",
      actor_id: "actor-1",
      actor_role: "user",
      action: "update_partner",
      target_kind: "partner",
      target_id: "target-1",
      metadata: { name: "X", changed: ["name"] },
    });
  });
});
