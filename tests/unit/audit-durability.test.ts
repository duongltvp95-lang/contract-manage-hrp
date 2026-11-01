import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
import { recordAudit } from "@/lib/services/audit-logs";
const input = { organizationId: "org", actorId: "actor", actorRole: "user" as const,
  action: "login" as const, targetKind: "user" as const, targetId: null };
beforeEach(() => vi.resetAllMocks());
describe("durable audit acceptance", () => {
  it("reuses the event ID after a lost acknowledgement", async () => {
    const payloads: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation((_name, payload) => {
      payloads.push(payload);
      return { abortSignal: async () => payloads.length === 1
        ? { data: null, error: { code: "connection_lost" } }
        : { data: { id: payload.p_id, delivered: false }, error: null } };
    });
    expect((await recordAudit(input)).ok).toBe(true);
    expect(payloads).toHaveLength(2);
    expect(payloads[0].p_id).toBe(payloads[1].p_id);
  });
  it("does not report success when neither delivery nor durable acceptance is available", async () => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: { code: "unavailable" } }) });
    expect((await recordAudit(input)).ok).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("does not start persistence for an aborted request", async () => {
    expect((await recordAudit(input, { abortSignal: AbortSignal.abort() })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
