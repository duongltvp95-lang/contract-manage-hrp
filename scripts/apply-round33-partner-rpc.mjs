import { guardLegacyDdlScript } from "./lib/legacy-script-guard.mjs";

const { service } = guardLegacyDdlScript({
  scriptName: "scripts/apply-round33-partner-rpc.mjs",
  statementCount: 2,
  supersededBy: "supabase/migrations/20261106140200_partners_folded_keys_and_pagination.sql",
});

const RPC_SQL = `
create or replace function public.get_partners_summary(org_id uuid)
returns table (
  id uuid,
  organization_id uuid,
  name text,
  address text,
  tax_code text,
  status text,
  region text,
  abbreviation text,
  created_at timestamptz,
  updated_at timestamptz,
  contract_count bigint,
  companies text[]
)
language sql
security invoker
set search_path = public, extensions
as $$
  select
    p.id,
    p.organization_id,
    p.name,
    p.address,
    p.tax_code,
    p.status,
    p.region,
    p.abbreviation,
    p.created_at,
    p.updated_at,
    coalesce(c.contract_count, 0)::bigint as contract_count,
    coalesce(comp.companies, array[]::text[]) as companies
  from public.partners p
  left join (
    select partner_id, count(*)::bigint as contract_count
    from public.contracts
    where organization_id = org_id and archived_at is null
    group by partner_id
  ) c on c.partner_id = p.id
  left join (
    select pc.partner_id, array_agg(co.name order by co.name) as companies
    from public.partner_companies pc
    join public.companies co on co.id = pc.company_id
    group by pc.partner_id
  ) comp on comp.partner_id = p.id
  where p.organization_id = org_id
  order by p.name asc;
$$;
`;

console.log("[step] applying get_partners_summary via exec_sql...");
const { error } = await service.rpc("exec_sql", { sql: RPC_SQL });
if (error) {
  console.error("[fatal] exec_sql failed:", error.message);
  process.exit(1);
}

console.log("[step] reloading schema cache...");
await service.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
await new Promise((resolve) => setTimeout(resolve, 4000));

console.log("[step] verifying RPC call...");
const { data, error: probeError } = await service.rpc("get_partners_summary", {
  org_id: "11111111-1111-1111-1111-111111111111",
});

if (probeError) {
  console.error("[fatal] probe RPC failed:", probeError.message);
  process.exit(1);
}

console.log(`[ok] RPC applied and verified. Found ${data?.length ?? 0} partners.`);
