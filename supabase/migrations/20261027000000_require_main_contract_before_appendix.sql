-- Keep appendices from being persisted on a contract that has no main document.
-- This is enforced in the database so alternate upload clients cannot skip it.

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

revoke all on function public.require_main_contract_before_appendix()
  from public, anon, authenticated;
