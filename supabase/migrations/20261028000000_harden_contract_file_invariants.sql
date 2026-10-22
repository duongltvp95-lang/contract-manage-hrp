-- Forward migration: preserve appendix invariants when earlier migrations
-- have already been applied, and keep the privileged upload RPC server-only.

create or replace function public.require_main_contract_before_appendix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.kind = 'appendix' and not exists (
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

  return new;
end;
$function$;

drop trigger if exists contract_files_require_main_before_appendix
  on public.contract_files;

create trigger contract_files_require_main_before_appendix
  before insert or update of kind, organization_id, contract_id
  on public.contract_files
  for each row
  execute function public.require_main_contract_before_appendix();

create or replace function public.validate_contract_has_main_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.contracts as c
    where c.id = old.contract_id
      and c.organization_id = old.organization_id
  ) and exists (
    select 1
    from public.contract_files as cf
    where cf.contract_id = old.contract_id
      and cf.organization_id = old.organization_id
      and cf.kind = 'appendix'
  ) and not exists (
    select 1
    from public.contract_files as cf
    where cf.contract_id = old.contract_id
      and cf.organization_id = old.organization_id
      and cf.kind = 'document'
  ) then
    raise exception 'Cannot delete main contract document while appendices still exist on the contract'
      using errcode = '23514';
  end if;

  return null;
end;
$function$;

drop trigger if exists contract_files_ensure_main_exists_with_appendices
  on public.contract_files;

create constraint trigger contract_files_ensure_main_exists_with_appendices
  after delete or update of kind, contract_id, organization_id
  on public.contract_files
  deferrable initially immediate
  for each row
  execute function public.validate_contract_has_main_document();

revoke all on function public.require_main_contract_before_appendix()
  from public, anon, authenticated;
revoke all on function public.validate_contract_has_main_document()
  from public, anon, authenticated;

-- The Server Action resolves the session and the service validates the signed
-- upload reservation. The browser must not invoke this SECURITY DEFINER RPC.
revoke all on function public.complete_contract_file_upload(uuid, uuid, uuid, text, text, text, text, bigint, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_contract_file_upload(uuid, uuid, uuid, text, text, text, text, bigint, text, uuid, text)
  to service_role;
