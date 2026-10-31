-- The row patch and replacement company set commit or roll back together.
create or replace function public.update_partner_atomic(
  p_id uuid, p_organization_id uuid, p_patch jsonb, p_company_ids uuid[] default null
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_partner public.partners%rowtype;
  v_updated public.partners%rowtype;
  v_company_ids uuid[];
  v_tax text;
  v_names jsonb;
begin
  if public.current_organization_id() is distinct from p_organization_id then
    raise exception 'Partner is outside the caller tenant' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_patch) k
       where k not in ('name', 'address', 'tax_code', 'region', 'abbreviation', 'status')
     ) then
    raise exception 'Invalid partner patch' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('partner-update:' || p_organization_id::text, 0)
  );
  select p.* into v_partner from public.partners p
    where p.id = p_id and p.organization_id = p_organization_id for update;
  if not found then return null; end if;

  if p_company_ids is not null then
    if cardinality(p_company_ids) not between 1 and 100
       or array_position(p_company_ids, null) is not null
       or exists (
         select 1 from unnest(p_company_ids) selected(id)
         where not exists (
           select 1 from public.companies c
           where c.id = selected.id and c.organization_id = p_organization_id
         )
       ) then
      raise exception 'Invalid partner companies' using errcode = '22023';
    end if;
    select array_agg(distinct id) into v_company_ids from unnest(p_company_ids) selected(id);
  else
    select coalesce(array_agg(pc.company_id), '{}'::uuid[]) into v_company_ids
      from public.partner_companies pc where pc.partner_id = p_id;
  end if;
  v_tax := case when p_patch ? 'tax_code'
    then nullif(btrim(p_patch->>'tax_code'), '') else v_partner.tax_code end;
  if v_tax is not null and exists (
    select 1 from public.partners p
    join public.partner_companies pc on pc.partner_id = p.id
    where p.organization_id = p_organization_id and p.id <> p_id
      and p.tax_code = v_tax and pc.company_id = any(v_company_ids)
  ) then
    raise exception 'partner_tax_code_conflict' using errcode = '23505';
  end if;

  if p_company_ids is not null then
    delete from public.partner_companies where partner_id = p_id;
    insert into public.partner_companies (partner_id, company_id)
      select p_id, unnest(v_company_ids);
  end if;
  update public.partners p set
    name = case when p_patch ? 'name' then btrim(p_patch->>'name') else p.name end,
    address = case when p_patch ? 'address' then nullif(btrim(p_patch->>'address'), '') else p.address end,
    tax_code = v_tax,
    region = case when p_patch ? 'region' then nullif(btrim(p_patch->>'region'), '') else p.region end,
    abbreviation = case when p_patch ? 'abbreviation' then nullif(btrim(p_patch->>'abbreviation'), '') else p.abbreviation end,
    status = case when p_patch ? 'status' then p_patch->>'status' else p.status end
  where p.id = p_id and p.organization_id = p_organization_id returning p.* into v_updated;
  select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) into v_names
    from public.companies c where c.id = any(v_company_ids);
  return to_jsonb(v_updated) || jsonb_build_object('companies', v_names);
end;
$$;
revoke all on function public.update_partner_atomic(uuid, uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.update_partner_atomic(uuid, uuid, jsonb, uuid[]) to authenticated;
