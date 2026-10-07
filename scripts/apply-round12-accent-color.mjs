// scripts/apply-round12-accent-color.mjs
//
// Round 12, part 1 ops script — apply the profiles.accent_color migration to
// production Supabase via public.exec_sql, then verify the column exists and
// accepts a valid accent value.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round12-accent-color.mjs

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] Supabase env is missing in .env.local — refusing to run");
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STATEMENTS = [
  `alter table public.profiles add column if not exists accent_color text`,
  `alter table public.profiles drop constraint if exists profiles_accent_color_check`,
  `alter table public.profiles add constraint profiles_accent_color_check check (accent_color is null or accent_color in ('blue', 'green', 'rose', 'violet', 'orange', 'teal'))`,
  `comment on column public.profiles.accent_color is 'The UI accent preset key (blue/green/rose/violet/orange/teal). NULL = default (blue). Applied server-side as data-accent on <html>.'`,
  `grant update (accent_color) on public.profiles to authenticated`,
];

console.log(`[step] applying ${STATEMENTS.length} statements via public.exec_sql …`);

for (const [index, sql] of STATEMENTS.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] statement ${index + 1} failed: ${error.message}`);
    process.exit(1);
  }
}
console.log(`[step] ${STATEMENTS.length} statements applied`);

// Verify: the column exists (PostgREST select succeeds) and accepts a valid value.
const { error: selectError } = await service
  .from("profiles")
  .select("id, accent_color")
  .limit(1);
if (selectError) {
  console.error(`[fatal] accent_color column missing: ${selectError.message}`);
  process.exit(1);
}
console.log("[verify] profiles.accent_color column: OK");

// Probe the CHECK with the tombstone profile (stable throwaway row), then reset.
const TOMBSTONE_ID = "81c03089-de31-4799-9361-ead99bc525f3";
const { error: probeError } = await service
  .from("profiles")
  .update({ accent_color: "teal" })
  .eq("id", TOMBSTONE_ID);
if (probeError) {
  console.error(`[fatal] accent_color CHECK probe failed: ${probeError.message}`);
  process.exit(1);
}
await service
  .from("profiles")
  .update({ accent_color: null })
  .eq("id", TOMBSTONE_ID);
console.log("[verify] accent_color CHECK accepts a valid value: OK");

console.log("");
console.log("=== round 12 apply summary ===");
console.log(`statements applied: ${STATEMENTS.length}`);
console.log("accent_color column: OK");
console.log("[ok] done");
process.exit(0);
