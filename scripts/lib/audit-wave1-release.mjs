import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** @param {string} value */
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

export function auditWave1MigrationManifest() {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  // Frozen Wave 1 security hardening bundle (A01, A02, A03).
  const files = [
    "20261106120100_archived_contracts_rls.sql",
    "20261106120200_contracts_tenant_and_date_constraints.sql",
    "20261106120300_staged_contract_file_uploads.sql",
  ];
  return files.map((version) => {
    const sql = readFileSync(new URL(version, directory), "utf8");
    return { version, sha256: createHash("sha256").update(sql).digest("hex"), sql };
  });
}

const fingerprints = `jsonb_build_object(
  'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contracts t),
  'partners',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.partners t),
  'profilesCore',(select md5(coalesce(jsonb_agg((to_jsonb(t) - 'can_manage_archived' - 'updated_at') order by id)::text,'')) from public.profiles t),
  'files',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contract_files t),
  'companies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.companies t),
  'partnerCompanies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by partner_id,company_id)::text,'')) from public.partner_companies t)
)`;

export function buildAuditWave1MigrationSql() {
  const manifestJson = JSON.stringify(auditWave1MigrationManifest());
  const summaryJson = JSON.stringify(
    auditWave1MigrationManifest().map(({ version, sha256 }) => ({ version, sha256 })),
  );

  return `do $hrp_audit_wave1_release_20261106$
declare
  v_migration jsonb;
  v_checksum text;
  v_before jsonb;
  v_after jsonb;
  v_schema_before jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server release credentials required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hrp-audit-wave1-release-20261106', 0)
  );

  lock table
    public.contracts,
    public.partners,
    public.profiles,
    public.contract_files,
    public.companies,
    public.partner_companies
    in share mode;

  select ${fingerprints} into v_before;

  select jsonb_build_object(
    'contractConstraints',(
      select coalesce(jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid))),'[]'::jsonb)
        from pg_constraint where conrelid = 'public.contracts'::regclass
    ),
    'policies',(
      select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'cmd',cmd,'qual',qual,'withCheck',with_check)),'[]'::jsonb)
        from pg_policies where schemaname = 'public' and tablename in ('contracts','contract_files')
    )
  ) into v_schema_before;

  create schema if not exists hrp_private;
  revoke all on schema hrp_private from public, anon, authenticated;
  create table if not exists hrp_private.review_migrations(
    version text primary key,
    sha256 text not null,
    applied_at timestamptz not null default now()
  );
  create table if not exists hrp_private.review_releases(
    id text primary key,
    completed_at timestamptz not null default now(),
    fingerprints_before jsonb not null,
    fingerprints_after jsonb not null,
    schema_before jsonb not null,
    migration_count integer not null
  );
  revoke all on all tables in schema hrp_private from public, anon, authenticated;

  for v_migration in select value from jsonb_array_elements(${quote(manifestJson)}::jsonb)
  loop
    select sha256 into v_checksum
      from hrp_private.review_migrations
     where version = v_migration->>'version';

    if found then
      if v_checksum is distinct from v_migration->>'sha256' then
        raise exception 'Applied migration checksum changed: %', v_migration->>'version';
      end if;
    else
      execute v_migration->>'sql';
      insert into hrp_private.review_migrations(version, sha256)
      values (v_migration->>'version', v_migration->>'sha256');
    end if;
  end loop;

  select ${fingerprints} into v_after;
  if v_before is distinct from v_after then
    raise exception 'Business data fingerprints changed during Wave 1 schema release';
  end if;

  insert into hrp_private.review_releases(
    id,
    fingerprints_before,
    fingerprints_after,
    schema_before,
    migration_count
  )
  values (
    'audit-wave1-20261106',
    v_before,
    v_after,
    v_schema_before,
    jsonb_array_length(${quote(summaryJson)}::jsonb)
  )
  on conflict (id) do nothing;

  perform pg_notify('pgrst', 'reload schema');
end $hrp_audit_wave1_release_20261106$;`;
}

export const verifyAuditWave1Sql = `do $verify$
begin
  if has_column_privilege('authenticated','public.profiles','can_manage_archived','update')
     or has_function_privilege('anon','public.archive_contract_atomic(uuid)','execute')
     or has_function_privilege('anon','public.get_contract_archive_state(uuid)','execute') then
    raise exception 'Wave 1 privilege hardening incomplete';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contracts'::regclass
       and conname = 'contracts_partner_org_fkey'
       and convalidated
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contracts'::regclass
       and conname = 'contracts_company_org_fkey'
       and convalidated
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contracts'::regclass
       and conname = 'contracts_expiry_on_or_after_signed_check'
       and convalidated
  ) then
    raise exception 'Wave 1 contract constraints missing or not validated';
  end if;

  if not exists (
    select 1 from hrp_private.review_releases
     where id = 'audit-wave1-20261106'
       and fingerprints_before = fingerprints_after
  ) then
    raise exception 'Wave 1 release receipt or data integrity proof missing';
  end if;
end $verify$;`;

export function buildAuditWave1RollbackSql() {
  return `do $hrp_audit_wave1_rollback_20261106$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server rollback credentials required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hrp-audit-wave1-release-20261106', 0)
  );

  if to_regclass('hrp_private.review_releases') is null
     or not exists (select 1 from hrp_private.review_releases where id = 'audit-wave1-20261106') then
    return;
  end if;

  if exists (select 1 from hrp_private.review_releases where id = 'audit-wave2-20261106') then
    raise exception 'Rollback Wave 2 (audit-wave2-20261106) before rolling back Wave 1'
      using errcode = '2BP01';
  end if;

  lock table
    public.contracts,
    public.partners,
    public.profiles,
    public.contract_files,
    public.companies,
    public.partner_companies
    in share mode;

  select ${fingerprints} into v_before;

  create table if not exists hrp_private.review_rollbacks(
    id text primary key,
    rolled_back_at timestamptz not null default now(),
    fingerprints_before jsonb not null,
    fingerprints_after jsonb not null
  );
  revoke all on all tables in schema hrp_private from public, anon, authenticated;

  -- 1. Restore pre-Wave-1 upload intent helpers (from 20261031095000_pending_upload_cleanup.sql)
  -- while retaining file_id matching in cleanup/completion so pre-rollback staged rows reconcile safely.
  create or replace function public.register_contract_upload_intent(
    p_object_key text,
    p_file_id uuid,
    p_organization_id uuid,
    p_contract_id uuid,
    p_created_by uuid
  )
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare
    v_intent public.pending_contract_uploads%rowtype;
  begin
    if p_object_key is null
       or p_file_id is null
       or p_organization_id is null
       or p_contract_id is null
       or p_created_by is null
       or p_object_key not like ('contracts/' || p_organization_id::text || '/' || p_contract_id::text || '/' || p_file_id::text || '/%')
       or not exists (
         select 1 from public.contracts c
          where c.id = p_contract_id and c.organization_id = p_organization_id and c.archived_at is null
       )
       or not exists (
         select 1 from public.profiles p
          where p.id = p_created_by and p.organization_id = p_organization_id and p.is_active and not p.is_tombstone
       ) then
      raise exception 'Invalid pending upload' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('r2-object:' || p_object_key, 0));

    if exists (select 1 from public.contract_files f where f.id = p_file_id or f.object_key = p_object_key)
       or exists (select 1 from public.r2_cleanup_queue q where q.object_key = p_object_key) then
      return false;
    end if;

    select * into v_intent from public.pending_contract_uploads where object_key = p_object_key for update;
    if found then
      if v_intent.file_id is distinct from p_file_id
         or v_intent.organization_id is distinct from p_organization_id
         or v_intent.contract_id is distinct from p_contract_id
         or v_intent.created_by is distinct from p_created_by then
        raise exception 'Upload intent identity mismatch' using errcode = '22023';
      end if;
      update public.pending_contract_uploads
         set expires_at = greatest(expires_at, now() + interval '20 minutes')
       where object_key = p_object_key;
    else
      insert into public.pending_contract_uploads (
        object_key, file_id, organization_id, contract_id, created_by, expires_at
      )
      values (
        p_object_key, p_file_id, p_organization_id, p_contract_id, p_created_by, now() + interval '24 hours 20 minutes'
      );
    end if;
    return true;
  end;
  $fn$;

  create or replace function public.clear_completed_upload_intent()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    delete from public.pending_contract_uploads
     where file_id = new.id or object_key = new.object_key;
    return new;
  end;
  $fn$;

  create or replace function public.prepare_r2_cleanup(
    p_limit integer default 50,
    p_max_attempts integer default 5
  )
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare
    v_candidate record;
    v_intent public.pending_contract_uploads%rowtype;
    v_queued integer := 0;
    v_exhausted bigint;
  begin
    if p_limit is null or p_max_attempts is null
       or p_limit not between 1 and 200 or p_max_attempts not between 1 and 20 then
      raise exception 'Invalid cleanup bounds' using errcode = '22023';
    end if;
    for v_candidate in
      select object_key from public.pending_contract_uploads
       where expires_at < now() order by expires_at limit p_limit
    loop
      if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('r2-object:' || v_candidate.object_key, 0)) then
        continue;
      end if;
      select * into v_intent from public.pending_contract_uploads
       where object_key = v_candidate.object_key and expires_at < now() for update skip locked;
      if not found then continue; end if;
      if not exists (select 1 from public.contract_files f where f.id = v_intent.file_id or f.object_key = v_intent.object_key)
         and not exists (select 1 from public.r2_cleanup_queue q where q.object_key = v_intent.object_key) then
        insert into public.r2_cleanup_queue (object_key, reason, status, attempts, last_error)
        values (v_intent.object_key, 'reconciliation', 'pending', 0, 'Abandoned upload reservation expired');
        v_queued := v_queued + 1;
      end if;
      delete from public.pending_contract_uploads where object_key = v_intent.object_key;
    end loop;
    select count(*) into v_exhausted from public.r2_cleanup_queue
     where status in ('pending', 'failed', 'processing') and attempts >= p_max_attempts;
    return pg_catalog.jsonb_build_object('queued', v_queued, 'exhausted', v_exhausted);
  end;
  $fn$;

  revoke all on function
    public.register_contract_upload_intent(text, uuid, uuid, uuid, uuid),
    public.clear_completed_upload_intent(),
    public.prepare_r2_cleanup(integer, integer)
    from public, anon, authenticated, service_role;
  grant execute on function
    public.register_contract_upload_intent(text, uuid, uuid, uuid, uuid),
    public.prepare_r2_cleanup(integer, integer)
    to service_role;

  -- 2. Reverse 20261106120200_contracts_tenant_and_date_constraints.sql
  drop trigger if exists contracts_validate_write_invariants on public.contracts;
  drop function if exists public.validate_contract_write_invariants();

  alter table public.contracts
    drop constraint if exists contracts_expiry_on_or_after_signed_check;

  alter table public.contracts
    drop constraint if exists contracts_partner_org_fkey,
    drop constraint if exists contracts_partner_id_fkey,
    add constraint contracts_partner_id_fkey
      foreign key (partner_id) references public.partners (id) on delete restrict;

  alter table public.contracts
    drop constraint if exists contracts_company_org_fkey,
    drop constraint if exists contracts_company_id_fkey,
    add constraint contracts_company_id_fkey
      foreign key (company_id) references public.companies (id) on delete set null;

  alter table public.partners
    drop constraint if exists partners_id_organization_unique;
  drop index if exists public.partners_id_org_unique_idx;

  alter table public.companies
    drop constraint if exists companies_id_organization_unique;
  drop index if exists public.companies_id_org_unique_idx;

  -- 3. Reverse 20261106120100_archived_contracts_rls.sql
  drop function if exists public.archive_contract_atomic(uuid);
  drop function if exists public.get_contract_archive_state(uuid);

  drop policy if exists contracts_select_own_org on public.contracts;
  create policy contracts_select_own_org
    on public.contracts
    for select
    to authenticated
    using (organization_id = public.current_organization_id());

  drop policy if exists contracts_insert_own_org on public.contracts;
  create policy contracts_insert_own_org
    on public.contracts
    for insert
    to authenticated
    with check (organization_id = public.current_organization_id());

  drop policy if exists contract_files_select_own_org on public.contract_files;
  create policy contract_files_select_own_org
    on public.contract_files
    for select
    to authenticated
    using (organization_id = public.current_organization_id());

  drop function if exists public.can_read_archived_contracts();

  create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    insert into public.profiles (id, organization_id, full_name, role, is_active)
    values (
      new.id,
      public.default_organization_id(),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      'user',
      true
    )
    on conflict (id) do nothing;
    return new;
  end;
  $fn$;

  revoke all on function public.handle_new_user()
    from public, anon, authenticated, service_role;

  create or replace function public.protect_owner_profile()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
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
    end if;

    return new;
  end;
  $fn$;

  revoke all on function public.protect_owner_profile()
    from public, anon, authenticated, service_role;

  alter table public.profiles
    drop column if exists can_manage_archived;

  delete from hrp_private.review_migrations
   where version in (
     '20261106120100_archived_contracts_rls.sql',
     '20261106120200_contracts_tenant_and_date_constraints.sql',
     '20261106120300_staged_contract_file_uploads.sql'
   );

  delete from hrp_private.review_releases
   where id = 'audit-wave1-20261106';

  select ${fingerprints} into v_after;
  if v_before is distinct from v_after then
    raise exception 'Business data fingerprints changed during Wave 1 rollback';
  end if;

  insert into hrp_private.review_rollbacks(
    id,
    rolled_back_at,
    fingerprints_before,
    fingerprints_after
  )
  values (
    'audit-wave1-20261106',
    now(),
    v_before,
    v_after
  )
  on conflict (id) do update
    set rolled_back_at = excluded.rolled_back_at,
        fingerprints_before = excluded.fingerprints_before,
        fingerprints_after = excluded.fingerprints_after;

  perform pg_notify('pgrst', 'reload schema');
end $hrp_audit_wave1_rollback_20261106$;`;
}

export const verifyAuditWave1RollbackSql = `do $verify_rollback$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.profiles'::regclass
       and attname = 'can_manage_archived'
       and not attisdropped
  ) then
    raise exception 'Wave 1 rollback incomplete: can_manage_archived still exists';
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.contracts'::regclass
       and conname in (
         'contracts_partner_org_fkey',
         'contracts_company_org_fkey',
         'contracts_expiry_on_or_after_signed_check'
       )
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contracts'::regclass
       and conname = 'contracts_partner_id_fkey'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contracts'::regclass
       and conname = 'contracts_company_id_fkey'
  ) then
    raise exception 'Wave 1 rollback incomplete: contract constraints did not revert cleanly';
  end if;

  if exists (
    select 1 from hrp_private.review_releases
     where id = 'audit-wave1-20261106'
  ) or not exists (
    select 1 from hrp_private.review_rollbacks
     where id = 'audit-wave1-20261106'
       and fingerprints_before = fingerprints_after
  ) then
    raise exception 'Wave 1 rollback receipt or data integrity proof missing';
  end if;
end $verify_rollback$;`;
