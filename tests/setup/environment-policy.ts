export function assertIsolatedTestEnvironment(env: Record<string, string | undefined>): void {
  const required = ["TEST_SUPABASE_URL", "TEST_SUPABASE_ANON_KEY", "TEST_SUPABASE_SERVICE_ROLE_KEY",
    "TEST_ADMIN_EMAIL", "TEST_ADMIN_PASSWORD", "TEST_ADMIN_TOTP_SECRET",
    "TEST_R2_ACCOUNT_ID", "TEST_R2_ACCESS_KEY_ID", "TEST_R2_SECRET_ACCESS_KEY", "TEST_R2_BUCKET_NAME", "TEST_R2_ENDPOINT"];
  if (env.TEST_BACKEND_ISOLATED !== "1") throw new Error("Live tests require TEST_BACKEND_ISOLATED=1 and a dedicated test backend.");
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error("Missing isolated test settings: " + missing.join(", "));
  const url = new URL(env.TEST_SUPABASE_URL!);
  if (url.hostname === "vohrerrbthbrkwjllnlj.supabase.co" || env.TEST_R2_BUCKET_NAME === "hrp-contract") {
    throw new Error("Live tests refuse the production Supabase project or R2 bucket.");
  }
  for (const name of ["TEST_BASE_URL", "E2E_BASE_URL"]) {
    if (env[name] && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(env[name]!).hostname)) {
      throw new Error(name + " must point to a dedicated loopback test server.");
    }
  }
}
