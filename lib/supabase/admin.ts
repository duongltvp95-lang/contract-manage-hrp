import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — **server only**.
 *
 * This key bypasses RLS completely, so it must never reach a Client Component.
 * `server-only` above enforces that at build time: importing this module from
 * anything with "use client" fails the build rather than shipping the key.
 *
 * It exists for the two jobs the anon key cannot do:
 *   - reading `auth.users` (emails are not exposed through PostgREST at all);
 *   - the Admin API (creating a user), which is the only way to provision an
 *     account while public sign-up is deliberately disabled.
 *
 * Every caller must authorize the *human* first. The service-role client is not
 * an authorization mechanism — it is an escalation, and `services/users.ts` is
 * the only place allowed to use it.
 */

/**
 * True when the key is configured.
 *
 * NOTE for deployment: the Vercel project does NOT set
 * `SUPABASE_SERVICE_ROLE_KEY` yet, so user creation is unavailable in
 * production until the owner adds it (see docs/milestones/M9). This helper lets
 * the UI say so instead of failing with a stack trace.
 */
export function hasServiceRoleKey(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Thiếu biến môi trường SUPABASE_SERVICE_ROLE_KEY. Xem .env.example và thêm vào môi trường triển khai.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
