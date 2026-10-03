import { hasLiveBackend } from "../setup/env";

/**
 * Integration suite preamble — W1-WEB-039/040.
 *
 * `.env.local` is loaded by `tests/setup/env.ts`. When the credentials are
 * missing (a fork, or a CI run without secrets) the suites skip themselves
 * rather than failing, so `pnpm test:integration` is never a false alarm.
 */

if (!hasLiveBackend) {
  console.warn(
    "[integration] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / " +
      "SUPABASE_SERVICE_ROLE_KEY are not set — integration suites will be skipped.",
  );
}
