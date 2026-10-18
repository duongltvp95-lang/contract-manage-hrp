-- Migration: Atomic and idempotent partner lookup/creation for AI extraction flow
-- Uses Postgres transaction-level advisory locks to eliminate race conditions
-- when concurrent contract extractions extract the same partner name.

create or replace function public.find_or_create_partner_for_ai(
  p_org_id uuid,
  p_name text,
  p_tax_code text default null,
  p_address text default null,
  p_company_ids uuid[] default array[]::uuid[]
)
returns table (
  id uuid,
  name text,
  is_new boolean
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_partner_id uuid;
  v_partner_name text;
  v_caller_org_id uuid;
begin
  -- Ensure caller can only operate on their own organization
  v_caller_org_id := (select organization_id from public.profiles where id = auth.uid());
  if v_caller_org_id is null or v_caller_org_id <> p_org_id then
    p_org_id := coalesce(v_caller_org_id, p_org_id);
  end if;

  p_name := btrim(p_name);
  if char_length(p_name) = 0 then
    return;
  end if;

  -- Acquire transaction-level advisory lock scoped to (organization, lower(trimmed_name))
  -- This ensures concurrent transactions for the same partner wait rather than creating duplicates.
  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(lower(p_name)));

  -- 1. Check if partner with exact name (case-insensitive) already exists in this organization
  select p.id, p.name into v_partner_id, v_partner_name
  from public.partners p
  where p.organization_id = p_org_id
    and lower(btrim(p.name)) = lower(p_name)
  order by p.created_at asc
  limit 1;

  if v_partner_id is not null then
    return query select v_partner_id, v_partner_name, false;
    return;
  end if;

  -- 2. If tax code is provided, check if partner with same tax code already exists
  if p_tax_code is not null and btrim(p_tax_code) <> '' then
    select p.id, p.name into v_partner_id, v_partner_name
    from public.partners p
    where p.organization_id = p_org_id
      and p.tax_code = btrim(p_tax_code)
    order by p.created_at asc
    limit 1;

    if v_partner_id is not null then
      return query select v_partner_id, v_partner_name, false;
      return;
    end if;
  end if;

  -- 3. Insert new partner
  insert into public.partners (organization_id, name, address, tax_code, status)
  values (
    p_org_id,
    p_name,
    nullif(btrim(p_address), ''),
    nullif(btrim(p_tax_code), ''),
    'active'
  )
  returning partners.id, partners.name into v_partner_id, v_partner_name;

  -- 4. Link to chosen companies
  if p_company_ids is not null and array_length(p_company_ids, 1) > 0 then
    insert into public.partner_companies (partner_id, company_id)
    select v_partner_id, unnest(p_company_ids)
    on conflict do nothing;
  end if;

  return query select v_partner_id, v_partner_name, true;
end;
$$;

revoke all on function public.find_or_create_partner_for_ai(uuid, text, text, text, uuid[]) from public;
grant execute on function public.find_or_create_partner_for_ai(uuid, text, text, text, uuid[]) to authenticated;

comment on function public.find_or_create_partner_for_ai(uuid, text, text, text, uuid[]) is
  'Atomic partner lookup and creation for AI contract extraction flow. Uses pg_advisory_xact_lock to prevent concurrent duplicate inserts.';
