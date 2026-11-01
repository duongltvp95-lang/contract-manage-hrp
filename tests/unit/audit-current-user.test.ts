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

  it("forwards the session identity into durable event acceptance", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "actor-1",
      role: "user",
      organizationId: "org-1",
      email: null,
      fullName: null,
    });

    let inserted: Record<string, unknown> | undefined;

    mockCreateAdminClient.mockResolvedValue({
      rpc: (_name: string, payload: Record<string, unknown>) => {
          inserted = payload;
          return {
            abortSignal: async () => ({ data: { id: payload.p_id, delivered: true }, error: null }),
          };
      },
    });

    await recordCurrentUserAudit({
      action: "update_partner",
      targetKind: "partner",
      targetId: "target-1",
      metadata: { name: "X", changed: ["name"] },
    });

    expect(inserted).toMatchObject({
      p_organization_id: "org-1",
      p_actor_id: "actor-1",
      p_actor_role: "user",
      p_action: "update_partner",
      p_target_kind: "partner",
      p_target_id: "target-1",
      p_metadata: { name: "X", changed: ["name"] },
    });
  });
});
