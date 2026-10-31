import { describe, expect, it } from "vitest";
import { assertIsolatedTestEnvironment } from "../setup/environment-policy";
const isolated = {
  TEST_BACKEND_ISOLATED: "1", TEST_SUPABASE_URL: "https://dedicated-tests.supabase.co",
  TEST_SUPABASE_ANON_KEY: "test", TEST_SUPABASE_SERVICE_ROLE_KEY: "test",
  TEST_ADMIN_EMAIL: "test@example.invalid", TEST_ADMIN_PASSWORD: "test", TEST_ADMIN_TOTP_SECRET: "test",
  TEST_R2_ACCOUNT_ID: "test", TEST_R2_ACCESS_KEY_ID: "test", TEST_R2_SECRET_ACCESS_KEY: "test",
  TEST_R2_BUCKET_NAME: "hrp-contract-tests", TEST_R2_ENDPOINT: "https://test.r2.cloudflarestorage.com",
};
describe("live test isolation policy", () => {
  it("does not accept application credentials as a fallback", () => {
    expect(() => assertIsolatedTestEnvironment({ NEXT_PUBLIC_SUPABASE_URL: isolated.TEST_SUPABASE_URL })).toThrow();
    expect(() => assertIsolatedTestEnvironment({ TEST_BACKEND_ISOLATED: "1" })).toThrow("Missing");
  });
  it("rejects the known production backend, bucket and non-loopback app server", () => {
    expect(() => assertIsolatedTestEnvironment({ ...isolated, TEST_SUPABASE_URL: "https://vohrerrbthbrkwjllnlj.supabase.co" })).toThrow("production");
    expect(() => assertIsolatedTestEnvironment({ ...isolated, TEST_R2_BUCKET_NAME: "hrp-contract" })).toThrow("production");
    expect(() => assertIsolatedTestEnvironment({ ...isolated, E2E_BASE_URL: "https://cm.hrpartner.vn" })).toThrow("loopback");
  });
  it("accepts explicit test credentials and a loopback app", () => {
    expect(() => assertIsolatedTestEnvironment({ ...isolated, E2E_BASE_URL: "http://localhost:3308" })).not.toThrow();
  });
});
