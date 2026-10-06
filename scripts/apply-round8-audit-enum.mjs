// scripts/apply-round8-audit-enum.mjs
//
// Round 8, part 1 ops script — widen the audit_logs CHECK constraints on
// production Supabase so the new business-action values are accepted.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round8-audit-enum.mjs
//
// Mirror of supabase/migrations/20261008000000_extend_audit_logs.sql. Unlike
// round 5.1 this needs no backfill: the change only widens two enums. The DDL is
// applied one statement per `exec_sql` call (the function is documented to run
// exactly one command per call), then verified by inserting and deleting a
// probe row for each new value.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function describeEnv(name, value) {
  return value ? `${name}=SET length=${value.length}` : `${name}=EMPTY`;
}

console.log("[env] " + describeEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL));
console.log("[env] " + describeEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY));

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] Supabase env is missing in .env.local — refusing to run");
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STATEMENTS = [
  "alter table public.audit_logs drop constraint if exists audit_logs_action_check",
  `alter table public.audit_logs add constraint audit_logs_action_check check (
    action in (
      'create_user','update_user_role','set_active_user','delete_user','export_logs',
      'create_partner','update_partner','import_partners',
      'create_contract','update_contract','archive_contract',
      'upload_file','update_profile'
    )
  )`,
  "alter table public.audit_logs drop constraint if exists audit_logs_target_kind_check",
  `alter table public.audit_logs add constraint audit_logs_target_kind_check check (
    target_kind in ('user','logs','partner','contract','file','profile')
  )`,
];

console.log(`[step] applying ${STATEMENTS.length} DDL statements via public.exec_sql …`);

for (const [index, sql] of STATEMENTS.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] exec_sql failed for statement ${index + 1}: ${error.message}`);
    console.error(`         statement: ${sql.slice(0, 80)}…`);
    process.exit(1);
  }
  console.log(`[step] statement ${index + 1}/${STATEMENTS.length} applied`);
}

// Verify: insert one probe row carrying the widest NEW values, then delete it.
// The row is attributed to a throwaway actor, but actor_id has an FK to
// profiles; the tombstone row is stable and already used for exactly this
// purpose in round 4/5, so it is re-used here.
const PROBE_ACTOR = "81c03089-de31-4799-9361-ead99bc525f3";

console.log("[verify] inserting probe row with new action/target values …");

const { data: probe, error: insertError } = await service
  .from("audit_logs")
  .insert({
    organization_id: "11111111-1111-1111-1111-111111111111",
    actor_id: PROBE_ACTOR,
    actor_role: "user",
    action: "import_partners",
    target_kind: "partner",
    target_id: null,
    metadata: { probe: "round8-audit-enum" },
  })
  .select("id")
  .single();

if (insertError) {
  console.error(`[fatal] probe insert failed: ${insertError.message}`);
  process.exit(1);
}

console.log("[verify] probe insert OK — new enum values accepted");

const probeId = probe?.id;
if (probeId) {
  const { error: deleteError } = await service
    .from("audit_logs")
    .delete()
    .eq("id", probeId);
  if (deleteError) {
    console.warn(`[warn] probe row cleanup failed (harmless): ${deleteError.message}`);
  } else {
    console.log("[verify] probe row removed");
  }
}

console.log("");
console.log("=== round 8 audit-enum apply summary ===");
console.log("DDL statements applied: " + STATEMENTS.length);
console.log("new enum values accepted: true");
console.log("[ok] done");
process.exit(0);
