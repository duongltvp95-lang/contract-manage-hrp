import { config as loadEnv } from "dotenv";

/**
 * Loads `.env.local` for the suites that talk to real services.
 *
 * Only the integration and end-to-end suites need it; the unit suite must pass
 * with no configuration at all (it runs in CI on every push, with no secrets).
 */
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.test.local", override: true });

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * The account the suites sign in as.
 *
 * Both values come from the environment and have **no fallback** on purpose: an
 * earlier revision defaulted the password to the live admin credential, which
 * put a working production password into the repository. A test that cannot run
 * without a secret must say so, not quietly ship the secret.
 */
export const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
export const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";

/** True when the suites can actually reach the backend and sign in. */
export const hasLiveBackend = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY && ADMIN_EMAIL && ADMIN_PASSWORD,
);

if (!hasLiveBackend) {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY],
    ["TEST_ADMIN_EMAIL", ADMIN_EMAIL],
    ["TEST_ADMIN_PASSWORD", ADMIN_PASSWORD],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  console.warn(`[tests] live suites will be skipped — not configured: ${missing.join(", ")}`);
}
