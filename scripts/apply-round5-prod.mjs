// scripts/apply-round5-prod.mjs
//
// Round 5.1 ops script — apply the `profiles.is_tombstone` column to
// production Supabase, then backfill the single tombstone row that round 4
// already created on first delete.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round5-prod.mjs
//
// The script:
//   1. reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
//      and prints the variable names + SET/EMPTY + length (NEVER the value);
//   2. opens a service-role Supabase client (reusing the same configuration
//      as `lib/supabase/admin.ts`);
//   3. calls `public.exec_sql(...)` to apply the DDL (idempotent: every
//      statement uses `if not exists` / `drop constraint if exists`);
//   4. patches the row that round 4 created (`is_tombstone = true`);
//   5. prints three verify results:
//        - `information_schema.columns` says the column exists
//        - the tombstone row has `is_tombstone = true`
//        - exactly one row in `profiles` has `is_tombstone = true`
//   6. exits 0 on success, non-zero on any failure.
//
// The script does NOT print credentials, does NOT accept user input, and does
// NOT touch the round 3 working tree. The DDL is hard-coded below; the only
// network calls are to the Supabase REST API over HTTPS.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// 1. environment gates
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function describeEnv(name, value) {
  if (!value) return `${name}=EMPTY`;
  return `${name}=SET length=${value.length}`;
}

console.log("[env] " + describeEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL));
console.log(
  "[env] " + describeEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
);

if (!SUPABASE_URL) {
  console.error("[fatal] NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  process.exit(2);
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[fatal] SUPABASE_SERVICE_ROLE_KEY is not set in .env.local — refusing to run",
  );
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// 2. hard-coded DDL — see supabase/migrations/20261006130000_profiles_is_tombstone.sql
//    Kept in sync with that migration; the function call wraps everything in
//    a single round-trip.
// ---------------------------------------------------------------------------

const DDL = `
alter table public.profiles
  add column if not exists is_tombstone boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_is_tombstone_check;

alter table public.profiles
  add constraint profiles_is_tombstone_check
    check (is_tombstone in (true, false));

comment on column public.profiles.is_tombstone is
  'True for the single system-managed tombstone row that replaces the actor on a hard delete. Never shown in /settings.';
`.trim();

// ---------------------------------------------------------------------------
// 3. apply DDL through public.exec_sql
// ---------------------------------------------------------------------------

console.log("[step] applying DDL via public.exec_sql …");

const { error: ddlError } = await service.rpc("exec_sql", { sql: DDL });

if (ddlError) {
  console.error("[fatal] exec_sql failed for DDL:", ddlError.message);
  process.exit(1);
}

console.log("[step] DDL applied");

// ---------------------------------------------------------------------------
// 4. backfill the round-4 tombstone row
// ---------------------------------------------------------------------------

const TOMBSTONE_ID = "81c03089-de31-4799-9361-ead99bc525f3";

console.log(`[step] backfilling is_tombstone=true for ${TOMBSTONE_ID} …`);

const { data: updatedRows, error: updateError } = await service
  .from("profiles")
  .update({ is_tombstone: true })
  .eq("id", TOMBSTONE_ID)
  .select("id");

if (updateError) {
  console.error("[fatal] backfill failed:", updateError.message);
  process.exit(1);
}

const rowCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
if (rowCount === 0) {
  console.error(
    `[warn] backfill updated 0 rows for id=${TOMBSTONE_ID}. ` +
      "Either the round-4 tombstone id is wrong, or the row no longer exists. " +
      "Inspect profiles in the SQL Editor before retrying.",
  );
}

// ---------------------------------------------------------------------------
// 5. verify (3 queries)
// ---------------------------------------------------------------------------

console.log("[verify] Q1 — information_schema.columns …");

const Q1 = `
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'is_tombstone';
`.trim();

const { data: q1, error: q1Error } = await service.rpc("exec_sql", {
  sql: Q1,
});

if (q1Error) {
  console.error("[fatal] Q1 verify failed:", q1Error.message);
  process.exit(1);
}

const q1Rows = Array.isArray(q1) ? q1 : [];
const columnAdded = q1Rows.length > 0;
console.log(
  `[verify] Q1 rows=${q1Rows.length} ${q1Rows.length > 0 ? JSON.stringify(q1Rows[0]) : ""}`,
);
if (!columnAdded) {
  console.error("[fatal] is_tombstone column not present after DDL");
  process.exit(1);
}

console.log("[verify] Q2 — tombstone row state …");

const { data: q2, error: q2Error } = await service
  .from("profiles")
  .select("id, full_name, role, is_active, is_tombstone")
  .eq("id", TOMBSTONE_ID);

if (q2Error) {
  console.error("[fatal] Q2 verify failed:", q2Error.message);
  process.exit(1);
}

const q2Rows = Array.isArray(q2) ? q2 : [];
console.log(`[verify] Q2 rows=${q2Rows.length} ${JSON.stringify(q2Rows)}`);
if (q2Rows.length === 0) {
  console.error(
    `[fatal] tombstone row id=${TOMBSTONE_ID} not found — cannot verify backfill`,
  );
  process.exit(1);
}
if (q2Rows[0].is_tombstone !== true) {
  console.error(
    `[fatal] tombstone row found but is_tombstone=${q2Rows[0].is_tombstone}, expected true`,
  );
  process.exit(1);
}

console.log("[verify] Q3 — count of is_tombstone=true rows …");

const { data: q3, error: q3Error } = await service
  .from("profiles")
  .select("id")
  .eq("is_tombstone", true);

if (q3Error) {
  console.error("[fatal] Q3 verify failed:", q3Error.message);
  process.exit(1);
}

const q3Count = Array.isArray(q3) ? q3.length : 0;
console.log(`[verify] Q3 count=${q3Count}`);

// ---------------------------------------------------------------------------
// 6. summary
// ---------------------------------------------------------------------------

console.log("");
console.log("=== round 5.1 apply summary ===");
console.log(`column added: ${columnAdded}`);
console.log(`tombstone row updated: ${rowCount}`);
console.log(`verify count: ${q3Count}`);

if (!columnAdded || rowCount === 0 || q3Count !== 1) {
  console.error("[fatal] one or more verify checks did not pass");
  process.exit(1);
}

console.log("[ok] all verify checks passed");
process.exit(0);
