import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(), clear: vi.fn(), signIn: vi.fn(), audit: vi.fn(),
  profile: vi.fn(), cookieGet: vi.fn(), signOut: vi.fn(), getUser: vi.fn(),
}));
vi.mock("@/lib/login-budget", () => ({ claimLoginAttempt: mocks.claim, clearLoginAttempts: mocks.clear }));
vi.mock("@/lib/services/audit-logs", () => ({ recordAudit: mocks.audit, recordLogoutAudit: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet, set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mocks.signIn,
      getUser: mocks.getUser,
      signOut: mocks.signOut,
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  }),
}));
import { loginAction } from "@/app/login/actions";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue({ allowed: true, remaining: 4, expires_at: "2099-01-01T00:00:00Z" });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "test-user", email: "user@test.invalid" } }, error: null });
  mocks.profile.mockResolvedValue({ data: { organization_id: "test-org", role: "user", is_active: true }, error: null });
  mocks.audit.mockResolvedValue({ ok: true, data: { id: "audit" } });
});
describe("server login budget and success audit", () => {
  it("revokes a new session when post-login verification fails", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("Auth unavailable") });
    expect((await loginAction({ email: "user@test.invalid", password: "test" })).success).toBe(false);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("revokes a new session on unexpected errors before durable audit", async () => {
    mocks.clear.mockRejectedValue(new Error("DB unavailable"));
    expect((await loginAction({ email: "user@test.invalid", password: "test" })).success).toBe(false);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("revokes the new session if audit acceptance is unavailable", async () => {
    mocks.audit.mockResolvedValue({ ok: false, code: "db_error", message: "unavailable" });
    expect((await loginAction({ email: "user@test.invalid", password: "test" })).success).toBe(false);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("blocks Auth calls even when a client sends no lockout cookie", async () => {
    mocks.claim.mockResolvedValue({ allowed: false, remaining: 0, expires_at: "2099-01-01T00:00:00Z" });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await loginAction({ email: "USER@test.invalid", password: "wrong" })).success).toBe(false);
    }
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.claim).toHaveBeenCalledWith("user@test.invalid");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("fails closed if the counter is unavailable", async () => {
    mocks.claim.mockRejectedValue(new Error("DB unavailable"));
    expect((await loginAction({ email: "user@test.invalid", password: "test" })).success).toBe(false);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("audits trimmed-password success once and accounts for both Auth attempts", async () => {
    mocks.signIn.mockResolvedValueOnce({ error: { status: 400 } }).mockResolvedValueOnce({ error: null });
    const result = await loginAction({ email: "user@test.invalid", password: " password " });
    expect(result.success).toBe(true);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "login", actorId: "test-user" }), { timeoutMs: 2500 });
    expect(mocks.clear).toHaveBeenCalledWith("user@test.invalid");
  });
  it("sends an administrator to MFA enrollment/challenge", async () => {
    mocks.profile.mockResolvedValue({ data: { organization_id: "org", role: "admin", is_active: true }, error: null });
    expect(await loginAction({ email: "user@test.invalid", password: "test" })).toEqual({ success: true, mfaRequired: true });
  });
});
