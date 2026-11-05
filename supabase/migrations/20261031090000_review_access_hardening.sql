-- Revocation must apply to the Data API as well as the Next.js guards.
create or replace function public.current_organization_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid() and p.is_active and not p.is_tombstone;
$$;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and public.current_organization_id() is not null)
  with check (id = auth.uid() and public.current_organization_id() is not null);

-- Upload completion is server-only and verifies the signed reservation and R2.
revoke insert on public.contract_files from authenticated;
drop policy if exists contract_files_insert_own_org on public.contract_files;
revoke execute on function public.complete_contract_file_upload(uuid, uuid, uuid, text, text, text, text, bigint, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_contract_file_upload(uuid, uuid, uuid, text, text, text, text, bigint, text, uuid, text)
  to service_role;

create or replace function public.validate_contract_file_tenant()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.contracts c
    where c.id = new.contract_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Contract file tenant does not match its contract' using errcode = '23514';
  end if;
  if new.created_by is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.created_by and p.organization_id = new.organization_id
  ) then
    raise exception 'Contract file creator does not belong to its tenant' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_contract_file_tenant() from public, anon, authenticated;
create trigger contract_files_validate_tenant
  before insert or update of organization_id, contract_id, created_by on public.contract_files
  for each row execute function public.validate_contract_file_tenant();
