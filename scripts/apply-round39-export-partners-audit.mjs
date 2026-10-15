// scripts/apply-round39-export-partners-audit.mjs
//
// Round 39 ops script — widen audit_logs.action to include export_partners
// via public.exec_sql.

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
  `alter table public.audit_logs drop constraint if exists audit_logs_action_check`,
  `alter table public.audit_logs add constraint audit_logs_action_check check (action in ('create_user','update_user_role','set_active_user','delete_user','export_logs','create_partner','update_partner','import_partners','create_contract','update_contract','archive_contract','upload_file','update_profile','set_partner_status','delete_contract','delete_partner','unarchive_contract','export_partners'))`,
];

console.log(`[step] applying ${STATEMENTS.length} statements via public.exec_sql …`);

for (const [index, sql] of STATEMENTS.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] statement ${index + 1} failed: ${error.message}`);
    process.exit(1);
  }
}

// Probe check
const { data, error: insertError } = await service
  .from("audit_logs")
  .insert({
    organization_id: "11111111-1111-1111-1111-111111111111",
    actor_id: "81c03089-de31-4799-9361-ead99bc525f3",
    actor_role: "user",
    action: "export_partners",
    target_kind: "partner",
    target_id: null,
    metadata: { count: 0 },
  })
  .select("id")
  .single();

if (insertError) {
  console.error(`[fatal] export_partners CHECK probe failed: ${insertError.message}`);
  process.exit(1);
}

await service.from("audit_logs").delete().eq("id", data.id);
console.log("[ok] export_partners audit action added and verified successfully!");
