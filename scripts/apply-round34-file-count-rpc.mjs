import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] Supabase env is missing in .env.local");
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RPC_SQL = `
create or replace function public.count_contract_files(contract_ids uuid[])
returns table (
  contract_id uuid,
  file_count bigint
)
language sql
security invoker
set search_path = public, extensions
as $$
  select
    cf.contract_id,
    count(*)::bigint as file_count
  from public.contract_files cf
  where cf.contract_id = any(contract_ids)
  group by cf.contract_id;
$$;
`;

console.log("[step] applying count_contract_files via exec_sql...");
const { error } = await service.rpc("exec_sql", { sql: RPC_SQL });
if (error) {
  console.error("[fatal] exec_sql failed:", error.message);
  process.exit(1);
}

console.log("[step] reloading schema cache...");
await service.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
await new Promise((resolve) => setTimeout(resolve, 3000));

console.log("[step] verifying RPC call...");
const { data, error: probeError } = await service.rpc("count_contract_files", {
  contract_ids: ["00000000-0000-0000-0000-000000000000"],
});

if (probeError) {
  console.error("[fatal] probe RPC failed:", probeError.message);
  process.exit(1);
}

console.log(`[ok] count_contract_files RPC applied and verified successfully. Result rows: ${data?.length ?? 0}`);
