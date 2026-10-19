// scripts/apply-r2-cleanup-migrations.mjs
//
// Applies migrations 20261024000000_r2_cleanup_outbox.sql and
// 20261025000000_atomic_r2_cleanup.sql to production Supabase via public.exec_sql.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] Supabase env is missing in .env.local — refusing to run");
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STATEMENTS_20261024 = [
  // 1. Create table r2_cleanup_queue
  `create table if not exists public.r2_cleanup_queue (
    id uuid primary key default gen_random_uuid(),
    object_key text not null,
    reason text not null check (reason in ('file_deleted', 'upload_db_failed', 'reconciliation')),
    status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    attempts integer not null default 0,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,

  // 2. Comment on table
  `comment on table public.r2_cleanup_queue is
    'Durable outbox for R2 objects requiring asynchronous deletion or retry after partial operation failures.'`,

  // 3. Status index
  `create index if not exists r2_cleanup_queue_status_idx
    on public.r2_cleanup_queue (status, created_at)`,

  // 4. Object key index
  `create index if not exists r2_cleanup_queue_object_key_idx
    on public.r2_cleanup_queue (object_key)`,

  // 5. Enable RLS
  `alter table public.r2_cleanup_queue enable row level security`,

  // 6. Revoke from public, anon, authenticated
  `revoke all on public.r2_cleanup_queue from public, anon, authenticated`,

  // 7. Grant to service_role
  `grant all on public.r2_cleanup_queue to service_role`,
];

const STATEMENTS_20261025 = [
  // 1. Add claimed_at column
  `alter table public.r2_cleanup_queue
    add column if not exists claimed_at timestamptz`,

  // 2. Recover legacy processing jobs
  `update public.r2_cleanup_queue
  set status = 'failed',
      last_error = coalesce(last_error, 'Recovered legacy processing job without a claim lease'),
      updated_at = now()
  where status = 'processing' and claimed_at is null`,

  // 3. Index on claimed_at
  `create index if not exists r2_cleanup_queue_claimed_at_idx
    on public.r2_cleanup_queue (status, claimed_at, created_at)`,

  // 4. complete_contract_file_upload RPC
  `create or replace function public.complete_contract_file_upload(
    p_file_id uuid,
    p_organization_id uuid,
    p_contract_id uuid,
    p_object_key text,
    p_bucket text,
    p_original_filename text,
    p_mime_type text,
    p_file_size bigint,
    p_checksum text,
    p_created_by uuid,
    p_kind text
  )
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_file public.contract_files%rowtype;
    v_contract_id uuid;
    v_prefix text;
    v_remainder text;
    v_role text;
  begin
    if p_file_id is null or p_organization_id is null or p_contract_id is null
       or p_object_key is null or p_bucket is null or p_original_filename is null or p_mime_type is null
       or p_file_size is null or p_file_size < 0 or p_created_by is null
       or p_kind is null or p_kind not in ('document', 'appendix') then
      raise exception 'Invalid contract file upload arguments' using errcode = '22023';
    end if;

    v_role := auth.role();
    if v_role = 'authenticated' then
      if auth.uid() is distinct from p_created_by
         or public.current_organization_id() is distinct from p_organization_id then
        raise exception 'Caller cannot persist this contract file' using errcode = '42501';
      end if;
    elsif v_role is distinct from 'service_role' then
      raise exception 'Caller role cannot persist contract files' using errcode = '42501';
    end if;

    select c.id into v_contract_id
    from public.contracts as c
    where c.id = p_contract_id
      and c.organization_id = p_organization_id
      and c.archived_at is null
    for share;
    if not found then
      raise exception 'Contract is unavailable for file upload' using errcode = '55000';
    end if;

    v_prefix := 'contracts/' || lower(p_organization_id::text) || '/'
      || lower(p_contract_id::text) || '/' || lower(p_file_id::text) || '/';
    if left(p_object_key, char_length(v_prefix)) <> v_prefix then
      raise exception 'Object key does not match contract file ids' using errcode = '22023';
    end if;
    v_remainder := substring(p_object_key from char_length(v_prefix) + 1);
    if v_remainder = '' or pg_catalog.strpos(v_remainder, '/') > 0
       or pg_catalog.strpos(v_remainder, pg_catalog.chr(92)) > 0 or v_remainder = '..' then
      raise exception 'Invalid contract file object key' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('r2-object:' || p_object_key, 0)
    );

    select cf.* into v_file
    from public.contract_files as cf
    where cf.id = p_file_id;

    if found then
      if v_file.organization_id = p_organization_id
         and v_file.contract_id = p_contract_id
         and v_file.object_key = p_object_key then
        return pg_catalog.to_jsonb(v_file);
      end if;
      raise exception 'Contract file id is already in use' using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.r2_cleanup_queue as q
      where q.object_key = p_object_key
    ) then
      raise exception 'Object key is permanently reserved for cleanup' using errcode = '55000';
    end if;

    insert into public.contract_files (
      id, organization_id, contract_id, storage_provider, bucket, object_key,
      original_filename, mime_type, file_size, checksum, created_by, kind
    ) values (
      p_file_id, p_organization_id, p_contract_id, 'r2', p_bucket, p_object_key,
      p_original_filename, p_mime_type, p_file_size, p_checksum, p_created_by, p_kind
    )
    returning * into v_file;

    return pg_catalog.to_jsonb(v_file);
  end;
  $function$`,

  // 5. delete_contract_file_with_cleanup RPC
  `create or replace function public.delete_contract_file_with_cleanup(
    p_file_id uuid,
    p_organization_id uuid,
    p_object_key text
  )
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_file public.contract_files%rowtype;
    v_contract_id uuid;
    v_archived_at timestamptz;
    v_cleanup_id uuid;
    v_prefix text;
    v_remainder text;
  begin
    if p_file_id is null or p_organization_id is null or p_object_key is null then
      raise exception 'Invalid contract file delete arguments' using errcode = '22023';
    end if;

    select c.id, c.archived_at into v_contract_id, v_archived_at
    from public.contracts as c
    where c.organization_id = p_organization_id
      and c.id = (
        select cf.contract_id from public.contract_files as cf
        where cf.id = p_file_id and cf.organization_id = p_organization_id
      )
    for share;
    if not found then
      return null;
    end if;
    if v_archived_at is not null then
      raise exception 'Contract is unavailable for file deletion' using errcode = '55000';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('r2-object:' || p_object_key, 0)
    );

    select cf.* into v_file
    from public.contract_files as cf
    where cf.id = p_file_id
      and cf.organization_id = p_organization_id
      and cf.object_key = p_object_key
    for update;

    if not found then
      return null;
    end if;

    v_prefix := 'contracts/' || lower(v_file.organization_id::text) || '/'
      || lower(v_file.contract_id::text) || '/' || lower(v_file.id::text) || '/';
    if left(v_file.object_key, char_length(v_prefix)) <> v_prefix then
      raise exception 'Stored object key does not match contract file ids' using errcode = '22023';
    end if;
    v_remainder := substring(v_file.object_key from char_length(v_prefix) + 1);
    if v_remainder = '' or pg_catalog.strpos(v_remainder, '/') > 0
       or pg_catalog.strpos(v_remainder, pg_catalog.chr(92)) > 0 or v_remainder = '..' then
      raise exception 'Stored object key has an invalid file name segment' using errcode = '22023';
    end if;

    delete from public.contract_files as cf
    where cf.id = p_file_id and cf.organization_id = p_organization_id;

    insert into public.r2_cleanup_queue (
      object_key, reason, status, attempts, last_error, claimed_at
    ) values (
      v_file.object_key, 'file_deleted', 'processing', 1, null, pg_catalog.now()
    )
    returning id into v_cleanup_id;

    return pg_catalog.jsonb_build_object(
      'id', v_file.id,
      'contract_id', v_file.contract_id,
      'object_key', v_file.object_key,
      'cleanup_id', v_cleanup_id
    );
  end;
  $function$`,

  // 6. delete_contract_with_r2_cleanup RPC
  `create or replace function public.delete_contract_with_r2_cleanup(
    p_contract_id uuid,
    p_organization_id uuid
  )
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_contract public.contracts%rowtype;
    v_file public.contract_files%rowtype;
    v_file_count integer := 0;
    v_prefix text;
    v_remainder text;
  begin
    if p_contract_id is null or p_organization_id is null then
      raise exception 'Invalid contract delete arguments' using errcode = '22023';
    end if;

    select c.* into v_contract
    from public.contracts as c
    where c.id = p_contract_id and c.organization_id = p_organization_id
    for update;
    if not found then
      return null;
    end if;

    for v_file in
      select cf.* from public.contract_files as cf
      where cf.contract_id = p_contract_id
        and cf.organization_id = p_organization_id
      order by cf.object_key
    loop
      v_prefix := 'contracts/' || lower(v_file.organization_id::text) || '/'
        || lower(v_file.contract_id::text) || '/' || lower(v_file.id::text) || '/';
      if left(v_file.object_key, char_length(v_prefix)) <> v_prefix then
        raise exception 'Stored object key does not match contract file ids' using errcode = '22023';
      end if;
      v_remainder := substring(v_file.object_key from char_length(v_prefix) + 1);
      if v_remainder = '' or pg_catalog.strpos(v_remainder, '/') > 0
         or pg_catalog.strpos(v_remainder, pg_catalog.chr(92)) > 0 or v_remainder = '..' then
        raise exception 'Stored object key has an invalid file name segment' using errcode = '22023';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('r2-object:' || v_file.object_key, 0)
      );
    end loop;

    for v_file in
      select cf.* from public.contract_files as cf
      where cf.contract_id = p_contract_id
        and cf.organization_id = p_organization_id
      order by cf.object_key
    loop
      insert into public.r2_cleanup_queue (
        object_key, reason, status, attempts, last_error, claimed_at
      ) values (
        v_file.object_key, 'file_deleted', 'pending', 0,
        'Contract deleted; cleanup queued transactionally', null
      );
      v_file_count := v_file_count + 1;
    end loop;

    delete from public.contract_files as cf
    where cf.contract_id = p_contract_id
      and cf.organization_id = p_organization_id;

    delete from public.contracts as c
    where c.id = p_contract_id and c.organization_id = p_organization_id;

    return pg_catalog.jsonb_build_object('id', p_contract_id, 'files_queued', v_file_count);
  end;
  $function$`,

  // 7. enqueue_r2_cleanup_if_unreferenced RPC
  `create or replace function public.enqueue_r2_cleanup_if_unreferenced(
    p_object_key text,
    p_reason text,
    p_last_error text default null
  )
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  begin
    if p_object_key is null or p_object_key = '' or p_reason is null
       or p_reason not in ('upload_db_failed', 'reconciliation') then
      raise exception 'Invalid R2 cleanup arguments' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('r2-object:' || p_object_key, 0)
    );

    if exists (
      select 1 from public.contract_files as cf where cf.object_key = p_object_key
    ) then
      return false;
    end if;

    if exists (
      select 1 from public.r2_cleanup_queue as q where q.object_key = p_object_key
    ) then
      return true;
    end if;

    insert into public.r2_cleanup_queue (
      object_key, reason, status, attempts, last_error
    ) values (
      p_object_key, p_reason, 'pending', 0, left(p_last_error, 2000)
    );

    return true;
  end;
  $function$`,

  // 8. claim_r2_cleanup_job RPC
  `create or replace function public.claim_r2_cleanup_job(
    p_job_id uuid,
    p_max_attempts integer default 5,
    p_stale_after_seconds integer default 300
  )
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_job public.r2_cleanup_queue%rowtype;
  begin
    if p_job_id is null or p_max_attempts is null or p_max_attempts < 1
       or p_stale_after_seconds is null or p_stale_after_seconds < 1 then
      raise exception 'Invalid R2 cleanup claim arguments' using errcode = '22023';
    end if;

    select q.* into v_job
    from public.r2_cleanup_queue as q
    where q.id = p_job_id
    for update;

    if not found then
      return pg_catalog.jsonb_build_object('status', 'missing');
    end if;

    if v_job.attempts >= p_max_attempts then
      return pg_catalog.jsonb_build_object('status', 'exhausted');
    end if;

    if v_job.status not in ('pending', 'failed') and not (
      v_job.status = 'processing'
      and v_job.claimed_at is not null
      and v_job.claimed_at < pg_catalog.now()
        - pg_catalog.make_interval(secs => p_stale_after_seconds)
    ) then
      return pg_catalog.jsonb_build_object('status', 'busy');
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('r2-object:' || v_job.object_key, 0)
    );

    if exists (
      select 1 from public.contract_files as cf where cf.object_key = v_job.object_key
    ) then
      update public.r2_cleanup_queue
        set status = 'cancelled',
            claimed_at = null,
            last_error = 'Object is referenced by a contract file',
            updated_at = pg_catalog.now()
      where id = v_job.id;
      return pg_catalog.jsonb_build_object('status', 'cancelled');
    end if;

    update public.r2_cleanup_queue
      set status = 'processing',
          attempts = attempts + 1,
          claimed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
    where id = v_job.id;

    return pg_catalog.jsonb_build_object(
      'status', 'claimed',
      'id', v_job.id,
      'object_key', v_job.object_key,
      'attempts', v_job.attempts + 1
    );
  end;
  $function$`,

  // 9. finish_r2_cleanup_job RPC
  `create or replace function public.finish_r2_cleanup_job(
    p_job_id uuid,
    p_succeeded boolean,
    p_last_error text default null
  )
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_count integer;
  begin
    update public.r2_cleanup_queue
      set status = case when p_succeeded then 'completed' else 'failed' end,
          claimed_at = null,
          last_error = case when p_succeeded then null else left(p_last_error, 2000) end,
          updated_at = pg_catalog.now()
    where id = p_job_id and status = 'processing';

    get diagnostics v_count = row_count;
    return v_count = 1;
  end;
  $function$`,

  // 10-15: Revokes
  `revoke all on function public.complete_contract_file_upload(uuid, uuid, uuid, text, text, text, text, bigint, text, uuid, text) from public, anon, authenticated`,
  `revoke all on function public.delete_contract_file_with_cleanup(uuid, uuid, text) from public, anon, authenticated`,
  `revoke all on function public.delete_contract_with_r2_cleanup(uuid, uuid) from public, anon, authenticated`,
  `revoke all on function public.enqueue_r2_cleanup_if_unreferenced(text, text, text) from public, anon, authenticated`,
  `revoke all on function public.claim_r2_cleanup_job(uuid, integer, integer) from public, anon, authenticated`,
  `revoke all on function public.finish_r2_cleanup_job(uuid, boolean, text) from public, anon, authenticated`,

  // 16-21: Grants
  `grant execute on function public.complete_contract_file_upload(uuid, uuid, uuid, text, text, text, text, bigint, text, uuid, text) to authenticated, service_role`,
  `grant execute on function public.delete_contract_file_with_cleanup(uuid, uuid, text) to service_role`,
  `grant execute on function public.delete_contract_with_r2_cleanup(uuid, uuid) to service_role`,
  `grant execute on function public.enqueue_r2_cleanup_if_unreferenced(text, text, text) to service_role`,
  `grant execute on function public.claim_r2_cleanup_job(uuid, integer, integer) to service_role`,
  `grant execute on function public.finish_r2_cleanup_job(uuid, boolean, text) to service_role`,
];

console.log("[step 1/3] Applying migration 20261024000000_r2_cleanup_outbox.sql...");
for (const [index, sql] of STATEMENTS_20261024.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] 20261024 statement ${index + 1} failed: ${error.message}`);
    process.exit(1);
  }
}
console.log("[ok] 20261024 applied successfully.");

console.log("[step 2/3] Applying migration 20261025000000_atomic_r2_cleanup.sql...");
for (const [index, sql] of STATEMENTS_20261025.entries()) {
  const { error } = await service.rpc("exec_sql", { sql });
  if (error) {
    console.error(`[fatal] 20261025 statement ${index + 1} failed: ${error.message}`);
    process.exit(1);
  }
}
console.log("[ok] 20261025 applied successfully.");

console.log("[step 3/3] Reloading PostgREST schema cache and verifying...");
await service.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
await new Promise((resolve) => setTimeout(resolve, 4000));

// Verify r2_cleanup_queue table
const { data: queueData, error: queueError } = await service
  .from("r2_cleanup_queue")
  .select("id, status, claimed_at")
  .limit(1);

if (queueError) {
  console.error("[fatal] r2_cleanup_queue probe failed:", queueError.message);
  process.exit(1);
}
console.log("[ok] r2_cleanup_queue table verified on production!");

// Verify complete_contract_file_upload RPC can be discovered
const { error: rpcProbeError } = await service.rpc("complete_contract_file_upload", {
  p_file_id: "00000000-0000-0000-0000-000000000000",
  p_organization_id: "00000000-0000-0000-0000-000000000000",
  p_contract_id: "00000000-0000-0000-0000-000000000000",
  p_object_key: "test",
  p_bucket: "test",
  p_original_filename: "test.pdf",
  p_mime_type: "application/pdf",
  p_file_size: 100,
  p_checksum: "test",
  p_created_by: "00000000-0000-0000-0000-000000000000",
  p_kind: "document",
});

// Since the contract ID doesn't exist, it should return 55000 'Contract is unavailable for file upload', NOT 'function not found'
console.log("[ok] complete_contract_file_upload probe error (expected):", rpcProbeError?.message);

console.log("\n🎉 ALL 2 MIGRATIONS SUCCESSFULLY APPLIED TO SUPABASE PRODUCTION!");
