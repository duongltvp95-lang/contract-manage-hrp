import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** @param {string} value */
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

export function auditWave2MigrationManifest() {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  // Frozen Wave 2 workflow & scale bundle (A06, A10).
  const files = [
    "20261106140100_audit_deleted_actor_snapshots.sql",
    "20261106140200_partners_folded_keys_and_pagination.sql",
  ];
  return files.map((version) => {
    const sql = readFileSync(new URL(version, directory), "utf8");
    return { version, sha256: createHash("sha256").update(sql).digest("hex"), sql };
  });
}

// Note: 20261106140200 backfills partners.name_folded and partners.tax_code_folded,
// and 20261106140100 adds typed snapshot columns on audit_logs & audit_event_outbox.
// Every table — INCLUDING audit_logs and audit_event_outbox — is fingerprinted so
// losing any deleted-actor ID, name, or email during release OR rollback aborts immediately!
const fingerprints = `jsonb_build_object(
  'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contracts t),
  'partnersCore',(select md5(coalesce(jsonb_agg((to_jsonb(t) - 'name_folded' - 'tax_code_folded' - 'updated_at') order by id)::text,'')) from public.partners t),
  'profiles',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.profiles t),
  'files',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contract_files t),
  'companies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.companies t),
  'partnerCompanies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by partner_id,company_id)::text,'')) from public.partner_companies t),
  'auditLogs',(select md5(coalesce(jsonb_agg(jsonb_build_object(
    'row',(to_jsonb(t) - 'deleted_actor_id' - 'actor_name_snapshot' - 'actor_email_snapshot' - 'metadata'),
    'coreMetadata',(coalesce(t.metadata,'{}'::jsonb) - 'deletedActorId' - 'originalActorId' - 'actorNameSnapshot' - 'actorEmailSnapshot'),
    'deletedActorId',coalesce(to_jsonb(t)->>'deleted_actor_id', t.metadata->>'deletedActorId', t.metadata->>'originalActorId'),
    'actorNameSnapshot',coalesce(to_jsonb(t)->>'actor_name_snapshot', t.metadata->>'actorNameSnapshot'),
    'actorEmailSnapshot',coalesce(to_jsonb(t)->>'actor_email_snapshot', t.metadata->>'actorEmailSnapshot')
  ) order by t.id)::text,'')) from public.audit_logs t),
  'auditOutbox',(select md5(coalesce(jsonb_agg(jsonb_build_object(
    'row',(to_jsonb(t) - 'actor_name_snapshot' - 'actor_email_snapshot' - 'metadata'),
    'coreMetadata',(coalesce(t.metadata,'{}'::jsonb) - 'actorNameSnapshot' - 'actorEmailSnapshot'),
    'actorNameSnapshot',coalesce(to_jsonb(t)->>'actor_name_snapshot', t.metadata->>'actorNameSnapshot'),
    'actorEmailSnapshot',coalesce(to_jsonb(t)->>'actor_email_snapshot', t.metadata->>'actorEmailSnapshot')
  ) order by t.id)::text,'')) from public.audit_event_outbox t)
)`;

export function buildAuditWave2MigrationSql() {
  const manifestJson = JSON.stringify(auditWave2MigrationManifest());
  const summaryJson = JSON.stringify(
    auditWave2MigrationManifest().map(({ version, sha256 }) => ({ version, sha256 })),
  );

  return `do $hrp_audit_wave2_release_20261106$
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
    pg_catalog.hashtextextended('hrp-audit-wave2-release-20261106', 0)
  );

  lock table
    public.contracts,
    public.partners,
    public.profiles,
    public.contract_files,
    public.companies,
    public.partner_companies,
    public.audit_logs,
    public.audit_event_outbox
    in share mode;

  select ${fingerprints} into v_before;

  select jsonb_build_object(
    'partnerColumns',(
      select coalesce(jsonb_agg(column_name order by ordinal_position),'[]'::jsonb)
        from information_schema.columns
       where table_schema = 'public' and table_name = 'partners'
    ),
    'auditColumns',(
      select coalesce(jsonb_agg(column_name order by ordinal_position),'[]'::jsonb)
        from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_logs'
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
    raise exception 'Business data fingerprints changed during Wave 2 schema release';
  end if;

  insert into hrp_private.review_releases(
    id,
    fingerprints_before,
    fingerprints_after,
    schema_before,
    migration_count
  )
  values (
    'audit-wave2-20261106',
    v_before,
    v_after,
    v_schema_before,
    jsonb_array_length(${quote(summaryJson)}::jsonb)
  )
  on conflict (id) do nothing;

  perform pg_notify('pgrst', 'reload schema');
end $hrp_audit_wave2_release_20261106$;`;
}

export const verifyAuditWave2Sql = `do $verify$
begin
  if has_function_privilege('authenticated','public.prepare_actor_audit_for_user_delete(uuid,uuid,uuid,text,text)','execute')
     or has_function_privilege('authenticated','public.restore_actor_audit_after_failed_user_delete(uuid,uuid,uuid)','execute')
     or has_function_privilege('anon','public.get_partners_directory_page(uuid,text,text,text,text,integer,integer)','execute') then
    raise exception 'Wave 2 privilege hardening incomplete';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'audit_logs'
       and column_name = 'deleted_actor_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'partners'
       and column_name = 'name_folded'
  ) then
    raise exception 'Wave 2 schema columns missing';
  end if;

  if not exists (
    select 1 from hrp_private.review_releases
     where id = 'audit-wave2-20261106'
       and fingerprints_before = fingerprints_after
  ) then
    raise exception 'Wave 2 release receipt or data integrity proof missing';
  end if;
end $verify$;`;

export function buildAuditWave2RollbackSql() {
  return `do $hrp_audit_wave2_rollback_20261106$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server rollback credentials required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hrp-audit-wave2-release-20261106', 0)
  );

  if to_regclass('hrp_private.review_releases') is null
     or not exists (select 1 from hrp_private.review_releases where id = 'audit-wave2-20261106') then
    return;
  end if;

  lock table
    public.contracts,
    public.partners,
    public.profiles,
    public.contract_files,
    public.companies,
    public.partner_companies,
    public.audit_logs,
    public.audit_event_outbox
    in share mode;

  select ${fingerprints} into v_before;

  create table if not exists hrp_private.review_rollbacks(
    id text primary key,
    rolled_back_at timestamptz not null default now(),
    fingerprints_before jsonb not null,
    fingerprints_after jsonb not null
  );
  revoke all on all tables in schema hrp_private from public, anon, authenticated;

  -- 1. Reverse 20261106140200_partners_folded_keys_and_pagination.sql
  create or replace function public.audit_business_write()
  returns trigger language plpgsql security definer set search_path = ''
  as $fn$
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
         where key not in ('updated_at','created_at') and value is distinct from to_jsonb(old)->key;
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
  $fn$;

  revoke all on function public.audit_business_write()
    from public, anon, authenticated, service_role;

  drop trigger if exists partner_companies_require_at_least_one_link on public.partner_companies;
  drop function if exists public.enforce_partner_has_company_link();

  drop trigger if exists partner_companies_serialize_mutation on public.partner_companies;
  drop function if exists public.serialize_partner_company_mutation();
  drop table if exists hrp_private.partner_company_locks;

  drop function if exists public.get_partners_directory_page(uuid, text, text, text, text, integer, integer);

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
  as $fn$
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
    order by p.name asc;
  $fn$;

  drop index if exists public.partners_org_name_folded_idx;
  drop index if exists public.partners_org_tax_code_folded_idx;
  drop trigger if exists partners_sync_folded_columns on public.partners;
  drop function if exists public.sync_partner_folded_columns();

  alter table public.partners
    drop column if exists name_folded,
    drop column if exists tax_code_folded;

  drop function if exists public.fold_partner_text(text);

  -- 2. Reverse 20261106140100_audit_deleted_actor_snapshots.sql
  drop function if exists public.prepare_actor_audit_for_user_delete(uuid, uuid, uuid, text, text);
  drop function if exists public.restore_actor_audit_after_failed_user_delete(uuid, uuid, uuid);

  -- Preserve ALL historical deleted-actor snapshots in both hrp_private archive tables
  -- AND row metadata BEFORE dropping Wave 2 columns so zero attribution data is ever lost!
  create table if not exists hrp_private.audit_actor_snapshot_archive(
    log_id uuid primary key,
    organization_id uuid not null,
    deleted_actor_id uuid,
    actor_name_snapshot text,
    actor_email_snapshot text,
    archived_at timestamptz not null default now()
  );
  create table if not exists hrp_private.audit_outbox_snapshot_archive(
    event_id uuid primary key,
    organization_id uuid not null,
    actor_name_snapshot text,
    actor_email_snapshot text,
    archived_at timestamptz not null default now()
  );
  revoke all on table
    hrp_private.audit_actor_snapshot_archive,
    hrp_private.audit_outbox_snapshot_archive
    from public, anon, authenticated;

  insert into hrp_private.audit_actor_snapshot_archive(
    log_id,
    organization_id,
    deleted_actor_id,
    actor_name_snapshot,
    actor_email_snapshot,
    archived_at
  )
  select
    id,
    organization_id,
    deleted_actor_id,
    actor_name_snapshot,
    actor_email_snapshot,
    now()
  from public.audit_logs
  where deleted_actor_id is not null
     or actor_name_snapshot is not null
     or actor_email_snapshot is not null
  on conflict (log_id) do update
    set deleted_actor_id = coalesce(excluded.deleted_actor_id, hrp_private.audit_actor_snapshot_archive.deleted_actor_id),
        actor_name_snapshot = coalesce(excluded.actor_name_snapshot, hrp_private.audit_actor_snapshot_archive.actor_name_snapshot),
        actor_email_snapshot = coalesce(excluded.actor_email_snapshot, hrp_private.audit_actor_snapshot_archive.actor_email_snapshot),
        archived_at = excluded.archived_at;

  insert into hrp_private.audit_outbox_snapshot_archive(
    event_id,
    organization_id,
    actor_name_snapshot,
    actor_email_snapshot,
    archived_at
  )
  select
    id,
    organization_id,
    actor_name_snapshot,
    actor_email_snapshot,
    now()
  from public.audit_event_outbox
  where actor_name_snapshot is not null
     or actor_email_snapshot is not null
  on conflict (event_id) do update
    set actor_name_snapshot = coalesce(excluded.actor_name_snapshot, hrp_private.audit_outbox_snapshot_archive.actor_name_snapshot),
        actor_email_snapshot = coalesce(excluded.actor_email_snapshot, hrp_private.audit_outbox_snapshot_archive.actor_email_snapshot),
        archived_at = excluded.archived_at;

  update public.audit_logs
     set metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_strip_nulls(
       pg_catalog.jsonb_build_object(
         'deletedActorId', coalesce(deleted_actor_id::text, metadata->>'deletedActorId', metadata->>'originalActorId'),
         'originalActorId', coalesce(metadata->>'originalActorId', deleted_actor_id::text, metadata->>'deletedActorId'),
         'actorNameSnapshot', coalesce(actor_name_snapshot, metadata->>'actorNameSnapshot'),
         'actorEmailSnapshot', coalesce(actor_email_snapshot, metadata->>'actorEmailSnapshot')
       )
     )
   where deleted_actor_id is not null
      or actor_name_snapshot is not null
      or actor_email_snapshot is not null;

  update public.audit_event_outbox
     set metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_strip_nulls(
       pg_catalog.jsonb_build_object(
         'actorNameSnapshot', coalesce(actor_name_snapshot, metadata->>'actorNameSnapshot'),
         'actorEmailSnapshot', coalesce(actor_email_snapshot, metadata->>'actorEmailSnapshot')
       )
     )
   where actor_name_snapshot is not null
      or actor_email_snapshot is not null;

  alter table public.audit_event_outbox
    drop column if exists actor_name_snapshot,
    drop column if exists actor_email_snapshot;

  alter table public.audit_logs
    drop column if exists deleted_actor_id,
    drop column if exists actor_name_snapshot,
    drop column if exists actor_email_snapshot;

  create or replace function public.deliver_audit_event(p_id uuid)
  returns boolean language plpgsql security definer set search_path=''
  as $fn$
  declare
   v_event public.audit_event_outbox%rowtype;
   v_actor uuid;
   v_metadata jsonb;
  begin
   select * into v_event from public.audit_event_outbox where id=p_id for update;
   if not found then raise exception 'Audit event unavailable' using errcode='22023'; end if;
   if v_event.completed_at is not null then return true; end if;
   begin
    v_actor := v_event.actor_id;
    v_metadata := coalesce(v_event.metadata, '{}'::jsonb);
    if not exists (select 1 from public.profiles where id=v_actor and organization_id=v_event.organization_id) then
     select id into v_actor from public.profiles
      where organization_id=v_event.organization_id and is_tombstone order by id limit 1;
     if v_actor is null then raise exception 'Historical audit actor unavailable' using errcode='23503'; end if;
     v_metadata := v_metadata || jsonb_build_object(
       'originalActorId', v_event.actor_id,
       'deletedActorId', v_event.actor_id
     );
    end if;
    insert into public.audit_logs(id,organization_id,actor_id,actor_role,action,target_kind,target_id,metadata,created_at)
     values(v_event.id,v_event.organization_id,v_actor,v_event.actor_role,v_event.action,v_event.target_kind,
       v_event.target_id,v_metadata,v_event.occurred_at)
     on conflict (id) do nothing;
    update public.audit_event_outbox set completed_at=now(),attempts=attempts+1,last_error=null where id=p_id;
    return true;
   exception when others then
    update public.audit_event_outbox set attempts=attempts+1,last_error=sqlstate,
     next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer))
     where id=p_id;
    return false;
   end;
  end;
  $fn$;

  revoke all on function public.deliver_audit_event(uuid)
    from public, anon, authenticated, service_role;

  delete from hrp_private.review_migrations
   where version in (
     '20261106140100_audit_deleted_actor_snapshots.sql',
     '20261106140200_partners_folded_keys_and_pagination.sql'
   );

  delete from hrp_private.review_releases
   where id = 'audit-wave2-20261106';

  select ${fingerprints} into v_after;
  if v_before is distinct from v_after then
    raise exception 'Business data fingerprints changed during Wave 2 rollback';
  end if;

  insert into hrp_private.review_rollbacks(
    id,
    rolled_back_at,
    fingerprints_before,
    fingerprints_after
  )
  values (
    'audit-wave2-20261106',
    now(),
    v_before,
    v_after
  )
  on conflict (id) do update
    set rolled_back_at = excluded.rolled_back_at,
        fingerprints_before = excluded.fingerprints_before,
        fingerprints_after = excluded.fingerprints_after;

  perform pg_notify('pgrst', 'reload schema');
end $hrp_audit_wave2_rollback_20261106$;`;
}

export const verifyAuditWave2RollbackSql = `do $verify_rollback$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and (
         (table_name = 'partners' and column_name in ('name_folded', 'tax_code_folded'))
         or (table_name = 'audit_logs' and column_name in ('deleted_actor_id', 'actor_name_snapshot', 'actor_email_snapshot'))
       )
  ) then
    raise exception 'Wave 2 rollback incomplete: derived/snapshot columns still exist';
  end if;

  if exists (
    select 1 from hrp_private.review_releases
     where id = 'audit-wave2-20261106'
  ) or not exists (
    select 1 from hrp_private.review_rollbacks
     where id = 'audit-wave2-20261106'
       and fingerprints_before = fingerprints_after
  ) then
    raise exception 'Wave 2 rollback receipt or data integrity proof missing';
  end if;

  if to_regclass('hrp_private.audit_actor_snapshot_archive') is not null
     and exists (
       select 1
         from hrp_private.audit_actor_snapshot_archive a
         join public.audit_logs l on l.id = a.log_id
        where (a.deleted_actor_id is not null and coalesce(l.metadata->>'deletedActorId', l.metadata->>'originalActorId') is distinct from a.deleted_actor_id::text)
           or (a.actor_name_snapshot is not null and l.metadata->>'actorNameSnapshot' is distinct from a.actor_name_snapshot)
           or (a.actor_email_snapshot is not null and l.metadata->>'actorEmailSnapshot' is distinct from a.actor_email_snapshot)
     ) then
    raise exception 'Wave 2 rollback lost historical actor attribution in public.audit_logs.metadata';
  end if;
end $verify_rollback$;`;
