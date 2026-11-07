import { guardLegacyDdlScript } from "./lib/legacy-script-guard.mjs";

const { service } = guardLegacyDdlScript({
  scriptName: "scripts/apply-round38-performance-indexes.mjs",
  statementCount: 6,
  supersededBy: "supabase/migrations/20261021000000_performance_indexes.sql",
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
