// scripts/apply-round13-background-color.mjs
//
// Round 13, part 1 ops script — apply the profiles.background_color migration
// to production Supabase via public.exec_sql, then verify the column and CHECK.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round13-background-color.mjs

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
  `alter table public.profiles add column if not exists background_color text`,
  `alter table public.profiles drop constraint if exists profiles_background_color_check`,
  `alter table public.profiles add constraint profiles_background_color_check check (background_color is null or background_color in ('default', 'gray', 'blue', 'green', 'cream', 'pink'))`,
  `comment on column public.profiles.background_color is 'The UI background preset key (default/gray/blue/green/cream/pink). NULL = default. Applied server-side as data-background on <html>.'`,
  `grant update (background_color) on public.profiles to authenticated`,
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

// Verify the column exists.
const { error: selectError } = await service
  .from("profiles")
  .select("id, background_color")
  .limit(1);
if (selectError) {
  console.error(`[fatal] background_color column missing: ${selectError.message}`);
  process.exit(1);
}
console.log("[verify] profiles.background_color column: OK");

// Probe the CHECK with the tombstone profile (stable throwaway row), then reset.
const TOMBSTONE_ID = "81c03089-de31-4799-9361-ead99bc525f3";
const { error: probeError } = await service
  .from("profiles")
  .update({ background_color: "cream" })
  .eq("id", TOMBSTONE_ID);
if (probeError) {
  console.error(`[fatal] background_color CHECK probe failed: ${probeError.message}`);
  process.exit(1);
}
await service
  .from("profiles")
  .update({ background_color: null })
  .eq("id", TOMBSTONE_ID);
console.log("[verify] background_color CHECK accepts a valid value: OK");

console.log("");
console.log("=== round 13 apply summary ===");
console.log(`statements applied: ${STATEMENTS.length}`);
console.log("background_color column: OK");
console.log("[ok] done");
process.exit(0);
