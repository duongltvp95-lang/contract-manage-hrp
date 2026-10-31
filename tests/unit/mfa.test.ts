import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(), level: vi.fn(), list: vi.fn(), enroll: vi.fn(), unenroll: vi.fn(), verify: vi.fn(),
  audit: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/server-action", () => ({ authorized: mocks.access }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/services/audit-logs", () => ({ recordCurrentUserAudit: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { mfa: {
    getAuthenticatorAssuranceLevel: mocks.level, listFactors: mocks.list,
    enroll: mocks.enroll, unenroll: mocks.unenroll, challengeAndVerify: mocks.verify,
  } } }),
}));
import { requireMfa } from "@/lib/mfa";
import { beginMfaEnrollmentAction, verifyMfaAction } from "@/app/auth/mfa/actions";
const factorId = "aaaaaaaa-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ ok: true, user: { id: "user" } });
  mocks.level.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
  mocks.list.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
  mocks.enroll.mockResolvedValue({ data: { id: factorId, totp: { qr_code: "<svg/>", secret: "TEST-SECRET" } }, error: null });
  mocks.unenroll.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({ error: null });
});
describe("MFA enrollment, verification and sensitive access", () => {
  it("refuses AAL1 and accepts AAL2", async () => {
    const denied = await requireMfa();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("mfa_required");
    mocks.level.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    expect((await requireMfa()).ok).toBe(true);
  });
  it("does not infer AAL2 from an enrolled but unverified factor", async () => {
    mocks.level.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    expect((await requireMfa()).ok).toBe(false);
  });
  it("cleans only unverified TOTP enrollments before creating a new QR", async () => {
    mocks.list.mockResolvedValue({ data: { totp: [], all: [{ id: "pending", factor_type: "totp", status: "unverified" }] }, error: null });
    expect((await beginMfaEnrollmentAction()).ok).toBe(true);
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "pending" });
  });
  it("never removes an existing verified factor", async () => {
    mocks.list.mockResolvedValue({ data: { totp: [{ id: factorId, status: "verified" }], all: [] }, error: null });
    expect((await beginMfaEnrollmentAction()).ok).toBe(false);
    expect(mocks.unenroll).not.toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("validates OTP before provider calls and audits only successful verification", async () => {
    expect((await verifyMfaAction({ factorId, code: "123" })).ok).toBe(false);
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.verify.mockResolvedValueOnce({ error: { message: "invalid" } });
    expect((await verifyMfaAction({ factorId, code: "123456" })).ok).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect((await verifyMfaAction({ factorId, code: "123456" })).ok).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "verify_mfa" }), { timeoutMs: 2500 });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
});
