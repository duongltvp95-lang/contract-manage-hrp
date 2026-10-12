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
  `create index if not exists contracts_active_org_expiry_idx on public.contracts (organization_id, expiry_date) where archived_at is null`,
  `create index if not exists contracts_active_org_created_idx on public.contracts (organization_id, created_at desc) where archived_at is null`,
  `create index if not exists contracts_active_org_signed_idx on public.contracts (organization_id, signed_date desc) where archived_at is null`,
  `create index if not exists partners_org_status_idx on public.partners (organization_id, status)`,
  `create index if not exists partners_org_tax_code_idx on public.partners (organization_id, tax_code)`,
];

console.log(`[step] applying ${STATEMENTS.length} performance indexes via exec_sql...`);
for (let i = 0; i < STATEMENTS.length; i++) {
  const sql = STATEMENTS[i];
  console.log(`  [${i + 1}/${STATEMENTS.length}] ${sql.slice(0, 70)}...`);
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] statement ${i + 1} failed:`, error.message);
    process.exit(1);
  }
}

console.log("[step] reloading schema cache...");
await service.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
await new Promise((resolve) => setTimeout(resolve, 2000));

console.log("[ok] all 5 performance indexes applied successfully!");
