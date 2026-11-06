-- A01: Enforce archived contract and file metadata access in PostgreSQL RLS,
-- and provide a dedicated archive RPC that avoids UPDATE ... RETURNING visibility traps.

alter table public.profiles
  add column if not exists can_manage_archived boolean not null default false;

comment on column public.profiles.can_manage_archived is
  'Privileged capability to read archived contracts/files, unarchive contracts, and hard-delete entities. Locked from client UPDATE.';

revoke update (can_manage_archived) on public.profiles from public, anon, authenticated;

-- Backfill the protected system Owner (by fixed id or canonical email) before installing the owner guard.
update public.profiles p
   set role = 'admin',
       is_active = true,
       can_manage_archived = true
 where p.id = '495eb514-82d9-4969-a610-760947a0a79d'::uuid
    or exists (
      select 1
        from auth.users u
       where u.id = p.id
         and lower(btrim(u.email)) = 'duongltvp95@gmail.com'
    );

create or replace function public.protect_owner_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.id = '495eb514-82d9-4969-a610-760947a0a79d'::uuid then
      raise exception 'Không được phép xoá tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.id = '495eb514-82d9-4969-a610-760947a0a79d'::uuid then
    if new.role is distinct from 'admin' then
      raise exception 'Không ai có quyền chỉnh sửa vai trò của tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)'
        using errcode = '42501';
    end if;
    if new.is_active is distinct from true then
      raise exception 'Không ai có quyền vô hiệu hoá tài khoản Quản trị viên tối cao (duongltvp95@gmail.com)'
        using errcode = '42501';
    end if;
    if new.can_manage_archived is distinct from true then
      raise exception 'Không ai có quyền thu hồi quyền lưu trữ của Quản trị viên tối cao (duongltvp95@gmail.com)'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_owner_profile()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_owner_profile on public.profiles;
create trigger trg_protect_owner_profile
  before update or delete on public.profiles
  for each row execute function public.protect_owner_profile();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean := (
    new.id = '495eb514-82d9-4969-a610-760947a0a79d'::uuid
    or lower(btrim(coalesce(new.email, ''))) = 'duongltvp95@gmail.com'
  );
begin
  insert into public.profiles (
    id,
    organization_id,
    full_name,
    role,
    is_active,
    can_manage_archived
  )
  values (
    new.id,
    public.default_organization_id(),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_is_owner then 'admin' else 'user' end,
    true,
    v_is_owner
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

create or replace function public.can_read_archived_contracts()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.can_manage_archived
        from public.profiles p
       where p.id = auth.uid()
         and p.is_active
         and not p.is_tombstone
    ),
    false
  );
$$;

revoke all on function public.can_read_archived_contracts()
  from public, anon, authenticated, service_role;
grant execute on function public.can_read_archived_contracts()
  to authenticated, service_role;

drop policy if exists contracts_select_own_org on public.contracts;
create policy contracts_select_own_org
  on public.contracts
  for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    and (archived_at is null or public.can_read_archived_contracts())
  );

drop policy if exists contracts_insert_own_org on public.contracts;
create policy contracts_insert_own_org
  on public.contracts
  for insert
  to authenticated
  with check (
    organization_id = public.current_organization_id()
    and (archived_at is null or public.can_read_archived_contracts())
  );

drop policy if exists contract_files_select_own_org on public.contract_files;
create policy contract_files_select_own_org
  on public.contract_files
  for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    and exists (
      select 1
        from public.contracts c
       where c.id = contract_files.contract_id
         and c.organization_id = contract_files.organization_id
         and (c.archived_at is null or public.can_read_archived_contracts())
    )
  );

-- Minimal status lookup scoped strictly to the caller's active organization.
-- Reveals zero contract fields or file metadata while allowing the UI/services
-- to distinguish an archived contract in the caller's org from a missing/foreign id.
create or replace function public.get_contract_archive_state(p_contract_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_organization_id();
  v_archived_at timestamptz;
begin
  if v_org is null or p_contract_id is null then
    return 'missing';
  end if;

  select c.archived_at
    into v_archived_at
    from public.contracts c
   where c.id = p_contract_id
     and c.organization_id = v_org;

  if not found then
    return 'missing';
  end if;

  if v_archived_at is not null then
    return 'archived';
  end if;

  return 'active';
end;
$$;

revoke all on function public.get_contract_archive_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_contract_archive_state(uuid)
  to authenticated, service_role;

-- Dedicated archive RPC for authenticated callers:
-- Checks active membership + tenant ownership, stamps archived_at, triggers
-- transactional business audit, and returns only confirmation metadata.
create or replace function public.archive_contract_atomic(p_contract_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_organization_id();
  v_archived_at timestamptz;
  v_new_archived_at timestamptz;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or v_org is null then
    raise exception 'Authentication required to archive contract'
      using errcode = '42501';
  end if;

  if p_contract_id is null then
    return pg_catalog.jsonb_build_object('status', 'missing');
  end if;

  select c.archived_at
    into v_archived_at
    from public.contracts c
   where c.id = p_contract_id
     and c.organization_id = v_org
   for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing');
  end if;

  if v_archived_at is not null then
    return pg_catalog.jsonb_build_object('status', 'already_archived');
  end if;

  update public.contracts
     set archived_at = now()
   where id = p_contract_id
     and organization_id = v_org
     and archived_at is null
   returning archived_at into v_new_archived_at;

  return pg_catalog.jsonb_build_object(
    'status', 'archived',
    'id', p_contract_id,
    'archived_at', v_new_archived_at
  );
end;
$$;

revoke all on function public.archive_contract_atomic(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.archive_contract_atomic(uuid)
  to authenticated;
