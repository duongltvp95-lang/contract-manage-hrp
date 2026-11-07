-- A03: Stage browser PUT uploads under uploads-staging/ so clients never hold
-- write credentials to canonical contracts/ object keys.
-- During zero-downtime release transitions or app-only rollbacks, the server-only
-- register_contract_upload_intent RPC also accepts canonical contracts/ keys from
-- the pre-Wave-1 server while the new server exclusively issues uploads-staging/ keys.

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
as $$
declare
  v_intent public.pending_contract_uploads%rowtype;
  v_staging_prefix text;
  v_canonical_prefix text;
  v_matched_prefix text;
  v_remainder text;
  v_staging_key text;
  v_final_key text;
begin
  if p_object_key is null
     or p_file_id is null
     or p_organization_id is null
     or p_contract_id is null
     or p_created_by is null then
    raise exception 'Invalid pending upload' using errcode = '22023';
  end if;

  v_staging_prefix := 'uploads-staging/'
    || lower(p_organization_id::text) || '/'
    || lower(p_contract_id::text) || '/'
    || lower(p_file_id::text) || '/';

  v_canonical_prefix := 'contracts/'
    || lower(p_organization_id::text) || '/'
    || lower(p_contract_id::text) || '/'
    || lower(p_file_id::text) || '/';

  if left(p_object_key, char_length(v_staging_prefix)) = v_staging_prefix then
    v_matched_prefix := v_staging_prefix;
  elsif left(p_object_key, char_length(v_canonical_prefix)) = v_canonical_prefix then
    v_matched_prefix := v_canonical_prefix;
  else
    raise exception 'Invalid pending upload' using errcode = '22023';
  end if;

  v_remainder := substring(p_object_key from char_length(v_matched_prefix) + 1);
  if v_remainder = ''
     or pg_catalog.strpos(v_remainder, '/') > 0
     or pg_catalog.strpos(v_remainder, pg_catalog.chr(92)) > 0
     or v_remainder = '.'
     or v_remainder = '..' then
    raise exception 'Invalid pending upload' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.contracts c
     where c.id = p_contract_id
       and c.organization_id = p_organization_id
       and c.archived_at is null
  ) or not exists (
    select 1
      from public.profiles p
     where p.id = p_created_by
       and p.organization_id = p_organization_id
       and p.is_active
       and not p.is_tombstone
  ) then
    raise exception 'Invalid pending upload' using errcode = '22023';
  end if;

  v_staging_key := v_staging_prefix || v_remainder;
  v_final_key := v_canonical_prefix || v_remainder;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('r2-object:' || v_final_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('r2-object:' || v_staging_key, 0)
  );

  if exists (
    select 1
      from public.contract_files f
     where f.id = p_file_id
        or f.object_key in (v_staging_key, v_final_key)
  ) or exists (
    select 1
      from public.r2_cleanup_queue q
     where q.object_key in (v_staging_key, v_final_key)
  ) then
    return false;
  end if;

  select *
    into v_intent
    from public.pending_contract_uploads
   where file_id = p_file_id
   for update;

  if found then
    if v_intent.object_key is distinct from p_object_key
       or v_intent.organization_id is distinct from p_organization_id
       or v_intent.contract_id is distinct from p_contract_id
       or v_intent.created_by is distinct from p_created_by then
      raise exception 'Upload intent identity mismatch' using errcode = '22023';
    end if;

    update public.pending_contract_uploads
       set expires_at = greatest(expires_at, now() + interval '20 minutes')
     where file_id = p_file_id;
  else
    -- Reservation is valid for 24h; allow the final 10-minute PUT URL and a grace period.
    insert into public.pending_contract_uploads (
      object_key,
      file_id,
      organization_id,
      contract_id,
      created_by,
      expires_at
    )
    values (
      p_object_key,
      p_file_id,
      p_organization_id,
      p_contract_id,
      p_created_by,
      now() + interval '24 hours 20 minutes'
    );
  end if;

  return true;
end;
$$;

create or replace function public.clear_completed_upload_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.pending_contract_uploads
   where file_id = new.id
      or object_key = new.object_key;
  return new;
end;
$$;

create or replace function public.prepare_r2_cleanup(
  p_limit integer default 50,
  p_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_intent public.pending_contract_uploads%rowtype;
  v_queued integer := 0;
  v_exhausted bigint;
begin
  if p_limit is null
     or p_max_attempts is null
     or p_limit not between 1 and 200
     or p_max_attempts not between 1 and 20 then
    raise exception 'Invalid cleanup bounds' using errcode = '22023';
  end if;

  for v_candidate in
    select object_key, file_id
      from public.pending_contract_uploads
     where expires_at < now()
     order by expires_at
     limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('r2-object:' || v_candidate.object_key, 0)
    ) then
      continue;
    end if;

    select *
      into v_intent
      from public.pending_contract_uploads
     where object_key = v_candidate.object_key
       and expires_at < now()
     for update skip locked;

    if not found then
      continue;
    end if;

    if not exists (
      select 1
        from public.contract_files f
       where f.id = v_intent.file_id
          or f.object_key = v_intent.object_key
    ) and not exists (
      select 1
        from public.r2_cleanup_queue q
       where q.object_key = v_intent.object_key
    ) then
      insert into public.r2_cleanup_queue (object_key, reason, status, attempts, last_error)
      values (
        v_intent.object_key,
        'reconciliation',
        'pending',
        0,
        'Abandoned upload reservation expired'
      );
      v_queued := v_queued + 1;
    end if;

    delete from public.pending_contract_uploads
     where object_key = v_intent.object_key;
  end loop;

  select count(*)
    into v_exhausted
    from public.r2_cleanup_queue
   where status in ('pending', 'failed', 'processing')
     and attempts >= p_max_attempts;

  return pg_catalog.jsonb_build_object('queued', v_queued, 'exhausted', v_exhausted);
end;
$$;

revoke all on function
  public.register_contract_upload_intent(text, uuid, uuid, uuid, uuid),
  public.clear_completed_upload_intent(),
  public.prepare_r2_cleanup(integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function
  public.register_contract_upload_intent(text, uuid, uuid, uuid, uuid),
  public.prepare_r2_cleanup(integer, integer)
  to service_role;
