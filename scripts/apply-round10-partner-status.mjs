// scripts/apply-round10-partner-status.mjs
//
// Round 10, part 1 ops script — apply the partner status + companies migration
// to production Supabase via public.exec_sql (one statement per call), then
// verify: the status column exists, the HRP/HR VN seed is present, and the
// audit-log enum accepts 'set_partner_status'.
//
// Usage (from repo root, with `.env.local` in place):
//
//   node scripts/apply-round10-partner-status.mjs

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

// Mirror of supabase/migrations/20261009000000_partner_status_companies.sql,
// one SQL statement per entry.
const STATEMENTS = [
  `alter table public.partners add column if not exists status text not null default 'active'`,
  `alter table public.partners drop constraint if exists partners_status_check`,
  `alter table public.partners add constraint partners_status_check check (status in ('active', 'stopped'))`,
  `comment on column public.partners.status is '''active'' = đang hợp tác (mặc định), ''stopped'' = đã dừng hợp tác.'`,

  `create table if not exists public.companies (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations (id) on delete restrict,
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint companies_name_length_check check (char_length(btrim(name)) between 1 and 100),
    constraint companies_org_name_unique unique (organization_id, name)
  )`,
  `drop trigger if exists set_companies_updated_at on public.companies`,
  `create trigger set_companies_updated_at before update on public.companies for each row execute function public.set_updated_at()`,
  `create index if not exists companies_organization_id_idx on public.companies (organization_id)`,

  `create table if not exists public.partner_companies (
    partner_id uuid not null references public.partners (id) on delete cascade,
    company_id uuid not null references public.companies (id) on delete cascade,
    primary key (partner_id, company_id)
  )`,
  `create index if not exists partner_companies_company_id_idx on public.partner_companies (company_id)`,

  `insert into public.companies (id, organization_id, name) values ('00000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'HRP') on conflict (organization_id, name) do nothing`,
  `insert into public.companies (id, organization_id, name) values ('00000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'HR VN') on conflict (organization_id, name) do nothing`,

  `alter table public.companies enable row level security`,
  `revoke all on public.companies from anon, authenticated`,
  `grant select on public.companies to authenticated`,
  `grant all on public.companies to service_role`,
  `drop policy if exists companies_select_own_org on public.companies`,
  `create policy companies_select_own_org on public.companies for select to authenticated using (organization_id = public.current_organization_id())`,

  `alter table public.partner_companies enable row level security`,
  `revoke all on public.partner_companies from anon, authenticated`,
  `grant select, insert, delete on public.partner_companies to authenticated`,
  `grant all on public.partner_companies to service_role`,
  `drop policy if exists partner_companies_select_own_org on public.partner_companies`,
  `create policy partner_companies_select_own_org on public.partner_companies for select to authenticated using (exists (select 1 from public.partners p where p.id = partner_companies.partner_id and p.organization_id = public.current_organization_id()))`,
  `drop policy if exists partner_companies_insert_own_org on public.partner_companies`,
  `create policy partner_companies_insert_own_org on public.partner_companies for insert to authenticated with check (exists (select 1 from public.partners p where p.id = partner_companies.partner_id and p.organization_id = public.current_organization_id()) and exists (select 1 from public.companies c where c.id = partner_companies.company_id and c.organization_id = public.current_organization_id()))`,
  `drop policy if exists partner_companies_delete_own_org on public.partner_companies`,
  `create policy partner_companies_delete_own_org on public.partner_companies for delete to authenticated using (exists (select 1 from public.partners p where p.id = partner_companies.partner_id and p.organization_id = public.current_organization_id()))`,

  `alter table public.audit_logs drop constraint if exists audit_logs_action_check`,
  `alter table public.audit_logs add constraint audit_logs_action_check check (action in ('create_user','update_user_role','set_active_user','delete_user','export_logs','create_partner','update_partner','import_partners','create_contract','update_contract','archive_contract','upload_file','update_profile','set_partner_status'))`,

  `create or replace function public.search_partners(term text, lim int default 50) returns setof public.partners language sql security invoker set search_path = public, extensions as $$ select * from public.partners where status = 'active' and (lower(replace(unaccent(coalesce(name, '')), 'đ', 'd')) like '%' || lower(replace(unaccent(coalesce(term, '')), 'đ', 'd')) || '%' or coalesce(tax_code, '') ilike '%' || coalesce(term, '') || '%') order by name asc limit lim; $$`,
];

console.log(`[step] applying ${STATEMENTS.length} statements via public.exec_sql …`);

for (const [index, sql] of STATEMENTS.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] statement ${index + 1} failed: ${error.message}`);
    console.error(`         ${sql.slice(0, 90)}…`);
    process.exit(1);
  }
}
console.log(`[step] ${STATEMENTS.length} statements applied`);

// --- verify 1: partners.status column exists ---------------------------------
const { error: statusError } = await service
  .from("partners")
  .select("id, status")
  .limit(1);
if (statusError) {
  console.error(`[fatal] partners.status missing: ${statusError.message}`);
  process.exit(1);
}
console.log("[verify] partners.status column: OK");

// --- verify 2: HRP + HR VN seed present -------------------------------------
const { data: companies, error: companiesError } = await service
  .from("companies")
  .select("name")
  .order("name");
if (companiesError) {
  console.error(`[fatal] companies query failed: ${companiesError.message}`);
  process.exit(1);
}
const names = (companies ?? []).map((c) => c.name).sort();
console.log(`[verify] companies: ${JSON.stringify(names)}`);
if (names.join(",") !== "HR VN,HRP") {
  console.error("[fatal] expected seed [HRP, HR VN]");
  process.exit(1);
}

// --- verify 3: audit enum accepts set_partner_status -------------------------
const { data: probe, error: probeError } = await service
  .from("audit_logs")
  .insert({
    organization_id: "11111111-1111-1111-1111-111111111111",
    actor_id: "81c03089-de31-4799-9361-ead99bc525f3",
    actor_role: "user",
    action: "set_partner_status",
    target_kind: "partner",
    target_id: null,
    metadata: { to: "stopped", probe: true },
  })
  .select("id")
  .single();

if (probeError) {
  console.error(`[fatal] audit enum probe failed: ${probeError.message}`);
  process.exit(1);
}
if (probe?.id) {
  await service.from("audit_logs").delete().eq("id", probe.id);
}
console.log("[verify] audit enum 'set_partner_status': OK");

console.log("");
console.log("=== round 10 apply summary ===");
console.log(`statements applied: ${STATEMENTS.length}`);
console.log("status column: OK");
console.log(`companies seed: ${names.join(", ")}`);
console.log("audit enum: OK");
console.log("[ok] done");
process.exit(0);
