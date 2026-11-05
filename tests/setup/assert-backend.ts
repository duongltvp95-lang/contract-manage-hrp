import { createClient } from "@supabase/supabase-js";
import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";

export async function assertTestBackendMarker(): Promise<void> {
  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.from("hrp_test_environment")
    .select("purpose").eq("id", 1).abortSignal(AbortSignal.timeout(5_000)).single();
  if (error || data?.purpose !== "hrp-isolated-tests") {
    throw new Error("Backend is not marked for destructive tests. Install tests/setup/test-environment.sql on the dedicated test project.");
  }
}
