-- Migration: Partner summary with DB aggregations (contract count + company names)
-- Task 3: Replace in-memory aggregations with a single security-invoker RPC.

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

comment on function public.get_partners_summary(uuid) is
  'Task 3 — Returns all partners for the organization with DB-aggregated contract counts and linked company names. Security invoker ensures caller organization RLS isolation.';
