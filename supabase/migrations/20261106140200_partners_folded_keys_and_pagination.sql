-- A10 (+ A02 junction invariant):
-- 1. Accent-folded lookup columns on public.partners matching foldText() for
--    targeted Excel duplicate checks and indexed directory search.
-- 2. Deterministic ordering (name ASC, id ASC) on get_partners_summary plus
--    paginated/filtered get_partners_directory_page RPC so directories > 1,000
--    rows never truncate silently.
-- 3. Deferred constraint trigger preventing authenticated callers from deleting
--    the last company link of a live partner in public.partner_companies.

create or replace function public.fold_partner_text(p_value text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select btrim(
    lower(
      replace(
        replace(
          unaccent(
            regexp_replace(
              normalize(coalesce(p_value, ''), NFD),
              '[\u0300-\u036f]+',
              '',
              'g'
            )
          ),
          'đ',
          'd'
        ),
        'Đ',
        'd'
      )
    )
  );
$$;

revoke all on function public.fold_partner_text(text) from public, anon;
grant execute on function public.fold_partner_text(text) to authenticated, service_role;

alter table public.partners
  add column if not exists name_folded text not null default '',
  add column if not exists tax_code_folded text;

create or replace function public.sync_partner_folded_columns()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tax_folded text;
begin
  new.name_folded := public.fold_partner_text(new.name);
  v_tax_folded := public.fold_partner_text(new.tax_code);
  new.tax_code_folded := nullif(v_tax_folded, '');
  return new;
end;
$$;

revoke all on function public.sync_partner_folded_columns()
  from public, anon, authenticated, service_role;

drop trigger if exists partners_sync_folded_columns on public.partners;
create trigger partners_sync_folded_columns
  before insert or update of name, tax_code on public.partners
  for each row execute function public.sync_partner_folded_columns();

update public.partners
   set name_folded = public.fold_partner_text(name),
       tax_code_folded = nullif(public.fold_partner_text(tax_code), '')
 where name_folded is distinct from public.fold_partner_text(name)
    or tax_code_folded is distinct from nullif(public.fold_partner_text(tax_code), '');

create index if not exists partners_org_name_folded_idx
  on public.partners (organization_id, name_folded);

create index if not exists partners_org_tax_code_folded_idx
  on public.partners (organization_id, tax_code_folded)
  where tax_code_folded is not null;

-- Deterministic tie-breaker (p.name asc, p.id asc) so range pagination never skips/duplicates rows.
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
  order by p.name asc, p.id asc;
$$;

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
        or a.name_folded like '%' || prm.q_folded || '%'
        or coalesce(a.tax_code_folded, '') like '%' || prm.q_folded || '%'
        or public.fold_partner_text(a.abbreviation) like '%' || prm.q_folded || '%'
        or public.fold_partner_text(a.region) like '%' || prm.q_folded || '%'
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

create schema if not exists hrp_private;
revoke all on schema hrp_private from public, anon, authenticated;

create table if not exists hrp_private.partner_company_locks (
  partner_id uuid primary key,
  generation bigint not null default 0
);
revoke all on table hrp_private.partner_company_locks from public, anon, authenticated;

-- Serialize partner_companies link removals/reassignments per partner_id across
-- concurrent transactions under both READ COMMITTED (blocks on advisory + row lock,
-- then deferred trigger reads committed state) and REPEATABLE READ / SERIALIZABLE
-- (aborts concurrent deleter with 40001 serialization failure on generation update).
create or replace function public.serialize_partner_company_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('partner-companies:' || old.partner_id::text, 0)
  );

  insert into hrp_private.partner_company_locks (partner_id, generation)
  values (old.partner_id, 1)
  on conflict (partner_id) do update
    set generation = hrp_private.partner_company_locks.generation + 1;

  if tg_op = 'UPDATE' and new.partner_id is distinct from old.partner_id then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('partner-companies:' || new.partner_id::text, 0)
    );
    insert into hrp_private.partner_company_locks (partner_id, generation)
    values (new.partner_id, 1)
    on conflict (partner_id) do update
      set generation = hrp_private.partner_company_locks.generation + 1;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.serialize_partner_company_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists partner_companies_serialize_mutation on public.partner_companies;
create trigger partner_companies_serialize_mutation
  before delete or update of partner_id on public.partner_companies
  for each row execute function public.serialize_partner_company_mutation();

create or replace function public.enforce_partner_has_company_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.partners p where p.id = old.partner_id
  ) and not exists (
    select 1 from public.partner_companies pc where pc.partner_id = old.partner_id
  ) then
    raise exception 'Partner must remain linked to at least one company'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_partner_has_company_link()
  from public, anon, authenticated, service_role;

drop trigger if exists partner_companies_require_at_least_one_link on public.partner_companies;
create constraint trigger partner_companies_require_at_least_one_link
  after delete or update of partner_id on public.partner_companies
  deferrable initially deferred
  for each row execute function public.enforce_partner_has_company_link();

-- Exclude derived partner search columns (name_folded, tax_code_folded) from
-- audit_logs.metadata.changed so partner updates only report user-meaningful fields.
create or replace function public.audit_business_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
 v_row jsonb;
 v_actor uuid := auth.uid();
 v_action text;
 v_kind text;
 v_target uuid;
 v_org uuid;
 v_meta jsonb := '{}'::jsonb;
 v_changed jsonb := '[]'::jsonb;
 v_name text;
begin
 if auth.role() is distinct from 'authenticated' or v_actor is null then
   return null;
 end if;
 v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='partner_companies' then
   v_target := (v_row->>'partner_id')::uuid;
   select organization_id,name into v_org,v_name from public.partners where id=v_target;
   if not found then return null; end if;
   v_kind := 'partner'; v_action := 'update_partner';
   v_changed := '["companies"]';
   v_meta := jsonb_build_object('name',v_name);
 else
   v_target := (v_row->>'id')::uuid; v_org := (v_row->>'organization_id')::uuid;
   if tg_op='UPDATE' then
     select coalesce(jsonb_agg(case key
       when 'contract_number' then 'contractNumber' when 'signed_date' then 'signedDate'
       when 'expiry_date' then 'expiryDate' when 'duration_text' then 'durationText'
       when 'partner_id' then 'partnerId' when 'company_id' then 'companyId'
       when 'partner_text' then 'partnerText' when 'tax_code' then 'taxCode'
       when 'full_name' then 'fullName' when 'accent_color' then 'accentColor'
       when 'background_color' then 'backgroundColor' when 'sidebar_color' then 'sidebarColor'
       when 'can_manage_archived' then 'canManageArchived'
       else key end order by key),'[]'::jsonb) into v_changed
       from jsonb_each(v_row) item
       where key not in ('updated_at','created_at','name_folded','tax_code_folded')
         and value is distinct from to_jsonb(old)->key;
   end if;
   if tg_table_name='contracts' then
     v_kind := 'contract';
     v_action := case when tg_op='INSERT' then 'create_contract'
       when old.archived_at is null and new.archived_at is not null then 'archive_contract'
       else 'update_contract' end;
     v_meta := jsonb_build_object('contractNumber',v_row->>'contract_number');
     v_meta := v_meta || jsonb_build_object(
       'partnerName',(select name from public.partners where id=(v_row->>'partner_id')::uuid and organization_id=v_org),
       'companyName',(select name from public.companies where id=(v_row->>'company_id')::uuid and organization_id=v_org));
     if tg_op='UPDATE' and old.expiry_date is distinct from new.expiry_date then
       v_meta := v_meta || jsonb_build_object('previousExpiryDate',old.expiry_date,'newExpiryDate',new.expiry_date);
       if old.expiry_date is not null and new.expiry_date > old.expiry_date then
         v_meta := v_meta || jsonb_build_object('action_subtype','renew_contract');
       end if;
     end if;
   elsif tg_table_name='partners' then
     v_kind := 'partner';
     v_action := case when tg_op='INSERT' then 'create_partner'
       when v_changed='["status"]'::jsonb then 'set_partner_status' else 'update_partner' end;
     v_meta := jsonb_build_object('name',v_row->>'name','status',v_row->>'status');
     v_meta := v_meta || jsonb_build_object('taxCode',v_row->>'tax_code','address',v_row->>'address');
     if tg_op='UPDATE' and old.status is distinct from new.status then
       v_meta := v_meta || jsonb_build_object('from',old.status,'to',new.status);
     end if;
   elsif tg_table_name='profiles' then
     v_kind := 'profile'; v_action := 'update_profile';
   end if;
 end if;
 if v_kind='partner' then
   v_meta := v_meta || jsonb_build_object('companies',(
     select coalesce(jsonb_agg(c.name order by c.name),'[]'::jsonb)
     from public.partner_companies pc join public.companies c on c.id=pc.company_id and c.organization_id=v_org
     where pc.partner_id=v_target));
 end if;
 perform public.append_transaction_audit(v_org,v_actor,v_action,v_kind,v_target,
   v_meta || jsonb_build_object('changed',v_changed,'source','database'));
 return null;
end;
$$;

revoke all on function public.audit_business_write()
  from public, anon, authenticated, service_role;
