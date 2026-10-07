// scripts/apply-round16-contract-files-kind.mjs
//
// Round 16, part 1 ops script — apply the contract_files.kind migration to
// production Supabase via public.exec_sql, then verify the column and CHECK.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round16-contract-files-kind.mjs

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
  `alter table public.contract_files add column if not exists kind text not null default 'document'`,
  `alter table public.contract_files drop constraint if exists contract_files_kind_check`,
  `alter table public.contract_files add constraint contract_files_kind_check check (kind in ('document', 'appendix'))`,
  `comment on column public.contract_files.kind is 'File kind: document = the main contract document (PDF/JPG/PNG), appendix = a PDF appendix. Existing rows default to document.'`,
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
  .from("contract_files")
  .select("id, kind")
  .limit(1);
if (selectError) {
  console.error(`[fatal] kind column missing: ${selectError.message}`);
  process.exit(1);
}
console.log("[verify] contract_files.kind column: OK");

console.log("");
console.log("=== round 16 apply summary ===");
console.log(`statements applied: ${STATEMENTS.length}`);
console.log("kind column: OK");
console.log("[ok] done");
process.exit(0);
