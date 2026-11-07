-- A10: Ensure literal substring matching (no SQL LIKE %/_/backslash wildcard
-- interpretation) and full NFD/NFC + đ/Đ accent folding across both
-- public.get_partners_directory_page and public.search_partners, with
-- deterministic (name ASC, id ASC) tie-breaking.

create or replace function public.get_partners_directory_page(
  p_org_id uuid,
  p_search text default null,
  p_status text default null,
  p_company text default null,
  p_contracts text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
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
  companies text[],
  total_count bigint
)
language sql
security invoker
set search_path = public, extensions
as $$
  with params as (
    select
      nullif(public.fold_partner_text(p_search), '') as q_folded,
      nullif(btrim(coalesce(p_status, '')), '') as status_filter,
      nullif(btrim(coalesce(p_company, '')), '') as company_filter,
      nullif(btrim(coalesce(p_contracts, '')), '') as contracts_filter,
      greatest(1, least(coalesce(p_limit, 100), 500)) as page_limit,
      greatest(0, coalesce(p_offset, 0)) as page_offset
  ),
  aggregated as (
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
      coalesce(comp.companies, array[]::text[]) as companies,
      p.name_folded,
      p.tax_code_folded
    from public.partners p
    left join (
      select partner_id, count(*)::bigint as contract_count
      from public.contracts
      where organization_id = p_org_id and archived_at is null
      group by partner_id
    ) c on c.partner_id = p.id
    left join (
      select pc.partner_id, array_agg(co.name order by co.name) as companies
      from public.partner_companies pc
      join public.companies co on co.id = pc.company_id
      group by pc.partner_id
    ) comp on comp.partner_id = p.id
    where p.organization_id = p_org_id
  ),
  filtered as (
    select a.*
    from aggregated a
    cross join params prm
    where (prm.status_filter is null or a.status = prm.status_filter)
      and (prm.company_filter is null or prm.company_filter = any(a.companies))
      and (
        prm.contracts_filter is null
        or (prm.contracts_filter = 'has' and a.contract_count >= 1)
        or (prm.contracts_filter = 'none' and a.contract_count = 0)
      )
      and (
        prm.q_folded is null
        or strpos(a.name_folded, prm.q_folded) > 0
        or strpos(coalesce(a.tax_code_folded, ''), prm.q_folded) > 0
        or strpos(public.fold_partner_text(a.abbreviation), prm.q_folded) > 0
        or strpos(public.fold_partner_text(a.region), prm.q_folded) > 0
      )
  )
  select
    f.id,
    f.organization_id,
    f.name,
    f.address,
    f.tax_code,
    f.status,
    f.region,
    f.abbreviation,
    f.created_at,
    f.updated_at,
    f.contract_count,
    f.companies,
    count(*) over()::bigint as total_count
  from filtered f
  order by f.name asc, f.id asc
  limit (select page_limit from params)
  offset (select page_offset from params);
$$;

revoke all on function public.get_partners_directory_page(uuid, text, text, text, text, integer, integer)
  from public, anon;
grant execute on function public.get_partners_directory_page(uuid, text, text, text, text, integer, integer)
  to authenticated, service_role;

create or replace function public.search_partners(term text, lim int default 50)
returns setof public.partners
language sql
security invoker
set search_path = public, extensions
as $$
  with params as (
    select
      nullif(public.fold_partner_text(term), '') as q_folded,
      greatest(1, least(coalesce(lim, 50), 200)) as row_limit
  )
  select p.*
  from public.partners p
  cross join params prm
  where p.status = 'active'
    and (
      prm.q_folded is null
      or strpos(p.name_folded, prm.q_folded) > 0
      or strpos(coalesce(p.tax_code_folded, ''), prm.q_folded) > 0
      or strpos(public.fold_partner_text(p.abbreviation), prm.q_folded) > 0
    )
  order by p.name asc, p.id asc
  limit (select row_limit from params);
$$;

revoke all on function public.search_partners(text, int) from public, anon;
grant execute on function public.search_partners(text, int) to authenticated;

comment on function public.search_partners(text, int) is
  'A10 — search the caller organization ACTIVE partners by name, abbreviation, or tax code using literal NFD/NFC folded substring matching and deterministic ordering. Stopped partners and region remain excluded. Security invoker: RLS limits results to the caller organization.';
