import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
