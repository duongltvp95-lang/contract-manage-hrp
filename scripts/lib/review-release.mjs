import { readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const quote = value => "'" + value.replaceAll("'", "''") + "'";
export function reviewMigrationManifest() {
  const directory = new URL('../../supabase/migrations/',import.meta.url);
  const files = readdirSync(directory).filter(name => name.endsWith('.sql') && name >= '20261031000000').sort();
  // Reapply this idempotent forward repair: production was provisioned manually
  // and its old completion RPC grant differs from the repository baseline.
  files.unshift('20261028000000_harden_contract_file_invariants.sql');
  return files.map(version => {
    const sql=readFileSync(new URL(version,directory),'utf8');
    return {version,sha256:createHash('sha256').update(sql).digest('hex'),sql};
  });
}
const fingerprints = `jsonb_build_object(
 'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contracts t),
 'partners',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.partners t),
 'profiles',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.profiles t),
 'files',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.contract_files t),
 'companies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.companies t),
 'partnerCompanies',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by partner_id,company_id)::text,'')) from public.partner_companies t))`;

export function buildReviewMigrationSql() {
  return `do $hrp_review_release_20261101$
declare v_migration jsonb; v_checksum text; v_before jsonb; v_after jsonb; v_schema_before jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server release credentials required' using errcode='42501'; end if;
 if current_setting('server_version_num')::integer<150000 then raise exception 'PostgreSQL 15 or newer required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hrp-review-release-20261101',0));
 -- Briefly prevent writes while checking identities and preserving fingerprints.
 lock table public.contracts,public.partners,public.profiles,public.contract_files,public.companies,public.partner_companies in share mode;
 select ${fingerprints} into v_before;
 if exists(select 1 from public.contracts where archived_at is null and nullif(btrim(contract_number),'') is not null
  group by organization_id,lower(btrim(contract_number)),signed_date,expiry_date having count(*)>1) then
  raise exception 'Duplicate active contract identities must be resolved before release' using errcode='23505';
 end if;
 select jsonb_build_object(
  'functions',(select coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))),'[]'::jsonb)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('exec_sql','current_organization_id','update_partner_atomic','complete_contract_file_upload','require_main_contract_before_appendix','validate_contract_has_main_document')),
  'profileTableAcl',(select relacl::text from pg_class where oid='public.profiles'::regclass),
  'profileColumnAcl',(select jsonb_agg(jsonb_build_object('column',attname,'acl',attacl::text)) from pg_attribute
    where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped),
  'auditConstraints',(select jsonb_agg(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.audit_logs'::regclass)
 ) into v_schema_before;
 create schema if not exists hrp_private;
 revoke all on schema hrp_private from public,anon,authenticated;
 create table if not exists hrp_private.review_migrations(version text primary key,sha256 text not null,applied_at timestamptz not null default now());
 create table if not exists hrp_private.review_releases(id text primary key,completed_at timestamptz not null default now(),
  fingerprints_before jsonb not null,fingerprints_after jsonb not null,schema_before jsonb not null,migration_count integer not null);
 revoke all on all tables in schema hrp_private from public,anon,authenticated;
 for v_migration in select value from jsonb_array_elements(${quote(JSON.stringify(reviewMigrationManifest()))}::jsonb)
 loop
  select sha256 into v_checksum from hrp_private.review_migrations where version=v_migration->>'version';
  if found then
   if v_checksum is distinct from v_migration->>'sha256' then raise exception 'Applied migration checksum changed: %',v_migration->>'version'; end if;
  else
   execute v_migration->>'sql';
   insert into hrp_private.review_migrations(version,sha256) values(v_migration->>'version',v_migration->>'sha256');
  end if;
 end loop;
 select ${fingerprints} into v_after;
 if v_before is distinct from v_after then raise exception 'Business data fingerprints changed during schema release'; end if;
 insert into hrp_private.review_releases(id,fingerprints_before,fingerprints_after,schema_before,migration_count)
  values('review-20261101',v_before,v_after,v_schema_before,jsonb_array_length(${quote(JSON.stringify(reviewMigrationManifest().map(({version,sha256})=>({version,sha256}))))}::jsonb))
  on conflict(id) do nothing;
 perform pg_notify('pgrst','reload schema');
end $hrp_review_release_20261101$;`;
}

export const verifyReviewSql = `do $verify$
begin
 if has_function_privilege('anon','public.exec_sql(text)','execute')
 or has_function_privilege('authenticated','public.exec_sql(text)','execute')
 or has_function_privilege('authenticated','public.complete_contract_file_upload(uuid,uuid,uuid,text,text,text,text,bigint,text,uuid,text)','execute')
 or has_table_privilege('authenticated','public.contract_files','insert')
 or has_column_privilege('authenticated','public.profiles','role','update') then
  raise exception 'A privileged operation remains exposed'; end if;
 if to_regclass('public.contract_listing') is null or to_regclass('public.audit_event_outbox') is null
 or to_regclass('public.pending_contract_uploads') is null then raise exception 'Release schema incomplete'; end if;
 if not exists(select 1 from hrp_private.review_releases where id='review-20261101' and fingerprints_before=fingerprints_after) then
  raise exception 'Release receipt or data integrity proof missing'; end if;
end $verify$;`;
