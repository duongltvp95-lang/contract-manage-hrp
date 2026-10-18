-- Migration: Atomic and idempotent partner lookup/creation for AI extraction flow
-- Uses Postgres transaction-level advisory locks to eliminate race conditions
-- when concurrent contract extractions extract the same partner name or tax code.

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
  v_clean_name text;
  v_clean_tax text;
  v_lock_name int4;
  v_lock_tax int4;
  v_partner_id uuid;
  v_partner_name text;
  v_caller_org_id uuid;
begin
  -- Ensure caller can only operate on their own organization
  v_caller_org_id := (select organization_id from public.profiles where id = auth.uid());
  if v_caller_org_id is null or v_caller_org_id <> p_org_id then
    p_org_id := coalesce(v_caller_org_id, p_org_id);
  end if;

  v_clean_name := btrim(coalesce(p_name, ''));
  if char_length(v_clean_name) = 0 then
    return;
  end if;

  -- Validate company IDs: every partner MUST be linked to at least one valid company of this organization.
  -- Rejects requests without companies to eliminate company-unaware tax code matching or orphan partners.
  if p_company_ids is null or array_length(p_company_ids, 1) is null or array_length(p_company_ids, 1) = 0 then
    return;
  end if;

  select coalesce(array_agg(c.id), array[]::uuid[]) into p_company_ids
  from public.companies c
  where c.organization_id = p_org_id
    and c.id = any(p_company_ids);

  if array_length(p_company_ids, 1) is null or array_length(p_company_ids, 1) = 0 then
    return;
  end if;

  v_clean_tax := nullif(btrim(coalesce(p_tax_code, '')), '');

  -- Acquire transaction-level advisory locks:
  -- 1) Lock the partner name domain: (p_org_id, 'name:' || lower(v_clean_name))
  -- 2) If tax code is provided, lock the tax code domain: (p_org_id, 'tax:' || v_clean_tax)
  -- To completely avoid deadlock between concurrent transactions acquiring both locks,
  -- we sort the two integer lock keys in ascending numerical order.
  v_lock_name := hashtext('name:' || lower(v_clean_name));

  if v_clean_tax is not null then
    v_lock_tax := hashtext('tax:' || v_clean_tax);
    if v_lock_name < v_lock_tax then
      perform pg_advisory_xact_lock(hashtext(p_org_id::text), v_lock_name);
      perform pg_advisory_xact_lock(hashtext(p_org_id::text), v_lock_tax);
    elsif v_lock_name > v_lock_tax then
      perform pg_advisory_xact_lock(hashtext(p_org_id::text), v_lock_tax);
      perform pg_advisory_xact_lock(hashtext(p_org_id::text), v_lock_name);
    else
      perform pg_advisory_xact_lock(hashtext(p_org_id::text), v_lock_name);
    end if;
  else
    perform pg_advisory_xact_lock(hashtext(p_org_id::text), v_lock_name);
  end if;

  -- 1. Check if partner with exact name (case-insensitive) already exists in this organization
  select p.id, p.name into v_partner_id, v_partner_name
  from public.partners p
  where p.organization_id = p_org_id
    and lower(btrim(p.name)) = lower(v_clean_name)
  order by p.created_at asc
  limit 1;

  if v_partner_id is not null then
    -- Ensure any missing company links from p_company_ids are linked
    insert into public.partner_companies (partner_id, company_id)
    select v_partner_id, unnest(p_company_ids)
    on conflict do nothing;

    return query select v_partner_id, v_partner_name, false;
    return;
  end if;

  -- 2. If tax code is provided, check if partner with same tax code already exists under an overlapping company
  -- Round 29 company-aware rule:
  -- Tax-code duplicate/conflict only applies within the SAME company or overlapping companies.
  -- The same tax code under a completely different company is allowed!
  if v_clean_tax is not null then
    select p.id, p.name into v_partner_id, v_partner_name
    from public.partners p
    join public.partner_companies pc on pc.partner_id = p.id
    where p.organization_id = p_org_id
      and p.tax_code = v_clean_tax
      and pc.company_id = any(p_company_ids)
    order by p.created_at asc
    limit 1;

    if v_partner_id is not null then
      -- Partner with same tax code found for overlapping company -> reuse partner
      insert into public.partner_companies (partner_id, company_id)
      select v_partner_id, unnest(p_company_ids)
      on conflict do nothing;

      return query select v_partner_id, v_partner_name, false;
      return;
    end if;
  end if;

  -- 3. Insert new partner
  insert into public.partners (organization_id, name, address, tax_code, status)
  values (
    p_org_id,
    v_clean_name,
    nullif(btrim(p_address), ''),
    v_clean_tax,
    'active'
  )
  returning partners.id, partners.name into v_partner_id, v_partner_name;

  -- 4. Link to chosen companies
  insert into public.partner_companies (partner_id, company_id)
  select v_partner_id, unnest(p_company_ids)
  on conflict do nothing;

  return query select v_partner_id, v_partner_name, true;
end;
$$;

revoke all on function public.find_or_create_partner_for_ai(uuid, text, text, text, uuid[]) from public;
grant execute on function public.find_or_create_partner_for_ai(uuid, text, text, text, uuid[]) to authenticated;

comment on function public.find_or_create_partner_for_ai(uuid, text, text, text, uuid[]) is
  'Atomic partner lookup and creation for AI contract extraction flow. Uses pg_advisory_xact_lock on name and tax code domains, and enforces company-aware tax code conflict rules.';
