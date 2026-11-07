import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
// and 20261106140100 adds nullable snapshot columns on audit_logs. Core business
// columns are fingerprinted excluding the new derived/snapshot columns so any
// unintended row mutation aborts the transaction immediately.
const fingerprints = `jsonb_build_object(
  'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contracts t),
  'partnersCore',(select md5(coalesce(jsonb_agg((to_jsonb(t) - 'name_folded' - 'tax_code_folded' - 'updated_at') order by id)::text,'')) from public.partners t),
  'profiles',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.profiles t),
  'files',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contract_files t),
  'companies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.companies t),
  'partnerCompanies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by partner_id,company_id)::text,'')) from public.partner_companies t)
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
    public.audit_logs
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
