import { config as loadEnv } from "dotenv";
import { assertIsolatedTestEnvironment } from "./environment-policy";

// Never fall back to .env.local or inherited application credentials.
loadEnv({ path: ".env.test.local", override: true, quiet: true });
assertIsolatedTestEnvironment(process.env);
for (const [target, source] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: "TEST_SUPABASE_URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "TEST_SUPABASE_ANON_KEY",
  SUPABASE_SERVICE_ROLE_KEY: "TEST_SUPABASE_SERVICE_ROLE_KEY",
  R2_ACCOUNT_ID: "TEST_R2_ACCOUNT_ID", R2_ACCESS_KEY_ID: "TEST_R2_ACCESS_KEY_ID",
  R2_SECRET_ACCESS_KEY: "TEST_R2_SECRET_ACCESS_KEY", R2_BUCKET_NAME: "TEST_R2_BUCKET_NAME", R2_ENDPOINT: "TEST_R2_ENDPOINT",
})) process.env[target] = process.env[source];
process.env.GEMINI_API_KEY = process.env.TEST_GEMINI_API_KEY ?? "";
process.env.CRON_SECRET = process.env.TEST_CRON_SECRET ?? "";
export const SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY!;
export const SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
export const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL!;
export const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD!;
export const hasLiveBackend = true;
