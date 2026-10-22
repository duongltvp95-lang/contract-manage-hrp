-- Forward migration: Enforce valid contract number on base contract before allowing appendices
-- This migration updates require_main_contract_before_appendix() to reject appendices if the contract lacks a valid contract_number,
-- and adds a trigger on public.contracts to prevent clearing contract_number if appendices already exist.

create or replace function public.require_main_contract_before_appendix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.kind = 'appendix' then
    if exists (
      select 1
      from public.contracts as c
      where c.id = new.contract_id
        and c.organization_id = new.organization_id
        and (c.contract_number is null or trim(c.contract_number) = '' or trim(c.contract_number) = '—')
    ) then
      raise exception 'A contract must have a valid contract number before an appendix can be uploaded'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.contract_files as main_file
      where main_file.id is distinct from new.id
        and main_file.organization_id = new.organization_id
        and main_file.contract_id = new.contract_id
        and main_file.kind = 'document'
    ) then
      raise exception 'A main contract document must be uploaded before its appendix'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

-- Trigger on public.contracts: prevent updating contract_number to null, empty, or '—' if appendices exist
create or replace function public.validate_contract_number_not_cleared_if_appendices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (new.contract_number is null or trim(new.contract_number) = '' or trim(new.contract_number) = '—') then
    if exists (
      select 1
      from public.contract_files as cf
      where cf.contract_id = new.id
        and cf.organization_id = new.organization_id
        and cf.kind = 'appendix'
    ) then
      raise exception 'Cannot clear contract number while appendices are attached to the contract'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists contracts_prevent_clear_number_with_appendices on public.contracts;
create trigger contracts_prevent_clear_number_with_appendices
  before update of contract_number
  on public.contracts
  for each row
  execute function public.validate_contract_number_not_cleared_if_appendices();
