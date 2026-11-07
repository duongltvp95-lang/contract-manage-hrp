-- A02: Enforce same-organization foreign keys, valid date order, and creator
-- immutability/tenant invariants directly in PostgreSQL on public.contracts.

create unique index if not exists partners_id_org_unique_idx
  on public.partners (id, organization_id);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.partners'::regclass
       and conname = 'partners_id_organization_unique'
  ) then
    alter table public.partners
      add constraint partners_id_organization_unique
      unique using index partners_id_org_unique_idx;
  end if;
end $$;

create unique index if not exists companies_id_org_unique_idx
  on public.companies (id, organization_id);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.companies'::regclass
       and conname = 'companies_id_organization_unique'
  ) then
    alter table public.companies
      add constraint companies_id_organization_unique
      unique using index companies_id_org_unique_idx;
  end if;
end $$;

alter table public.contracts
  drop constraint if exists contracts_partner_id_fkey,
  drop constraint if exists contracts_partner_org_fkey,
  add constraint contracts_partner_org_fkey
    foreign key (partner_id, organization_id)
    references public.partners (id, organization_id)
    on delete restrict;

alter table public.contracts
  drop constraint if exists contracts_company_id_fkey,
  drop constraint if exists contracts_company_org_fkey,
  add constraint contracts_company_org_fkey
    foreign key (company_id, organization_id)
    references public.companies (id, organization_id)
    on delete set null (company_id);

alter table public.contracts
  drop constraint if exists contracts_expiry_on_or_after_signed_check,
  add constraint contracts_expiry_on_or_after_signed_check
    check (expiry_date is null or signed_date is null or expiry_date >= signed_date);

create or replace function public.validate_contract_write_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    if auth.uid() is null then
      raise exception 'Authenticated user id is required'
        using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      if new.created_by is null then
        new.created_by := auth.uid();
      elsif new.created_by is distinct from auth.uid() then
        raise exception 'Contract creator must match authenticated user'
          using errcode = '42501';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.created_by is distinct from old.created_by then
        raise exception 'Contract creator cannot be modified'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if new.created_by is not null and (
    tg_op = 'INSERT'
    or new.created_by is distinct from old.created_by
    or new.organization_id is distinct from old.organization_id
  ) then
    if not exists (
      select 1
        from public.profiles p
       where p.id = new.created_by
         and p.organization_id = new.organization_id
    ) then
      raise exception 'Contract creator does not belong to its tenant'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_contract_write_invariants()
  from public, anon, authenticated, service_role;

drop trigger if exists contracts_validate_write_invariants on public.contracts;
create trigger contracts_validate_write_invariants
  before insert or update of organization_id, created_by on public.contracts
  for each row execute function public.validate_contract_write_invariants();
