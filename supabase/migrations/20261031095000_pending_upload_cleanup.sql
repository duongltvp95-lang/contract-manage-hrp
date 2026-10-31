create table public.pending_contract_uploads (
  object_key text primary key,
  file_id uuid not null unique,
  organization_id uuid not null,
  contract_id uuid not null,
  created_by uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- Intents deliberately survive contract/user deletion until the object is reconciled.
alter table public.pending_contract_uploads enable row level security;
revoke all on public.pending_contract_uploads from public, anon, authenticated;
grant all on public.pending_contract_uploads to service_role;
create index pending_contract_uploads_expiry_idx on public.pending_contract_uploads(expires_at);

create function public.register_contract_upload_intent(
  p_object_key text, p_file_id uuid, p_organization_id uuid, p_contract_id uuid, p_created_by uuid
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_intent public.pending_contract_uploads%rowtype;
begin
  if p_object_key is null or p_file_id is null or p_organization_id is null
     or p_contract_id is null or p_created_by is null
     or p_object_key not like ('contracts/' || p_organization_id::text || '/' || p_contract_id::text || '/' || p_file_id::text || '/%')
     or not exists (select 1 from public.contracts c
       where c.id=p_contract_id and c.organization_id=p_organization_id and c.archived_at is null)
     or not exists (select 1 from public.profiles p
       where p.id=p_created_by and p.organization_id=p_organization_id and p.is_active and not p.is_tombstone)
  then raise exception 'Invalid pending upload' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('r2-object:' || p_object_key,0));
  if exists (select 1 from public.contract_files f where f.id=p_file_id or f.object_key=p_object_key)
     or exists (select 1 from public.r2_cleanup_queue q where q.object_key=p_object_key) then
    return false;
  end if;
  select * into v_intent from public.pending_contract_uploads where object_key=p_object_key for update;
  if found then
    if v_intent.file_id is distinct from p_file_id
       or v_intent.organization_id is distinct from p_organization_id
       or v_intent.contract_id is distinct from p_contract_id
       or v_intent.created_by is distinct from p_created_by then
      raise exception 'Upload intent identity mismatch' using errcode='22023';
    end if;
    update public.pending_contract_uploads set expires_at=greatest(expires_at,now()+interval '20 minutes')
      where object_key=p_object_key;
  else
    -- Reservation is valid for 24h; allow the final 10-minute PUT URL and a grace period.
    insert into public.pending_contract_uploads
      (object_key,file_id,organization_id,contract_id,created_by,expires_at)
      values (p_object_key,p_file_id,p_organization_id,p_contract_id,p_created_by,now()+interval '24 hours 20 minutes');
  end if;
  return true;
end;
$$;

create function public.clear_completed_upload_intent()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.pending_contract_uploads where object_key=new.object_key;
  return new;
end;
$$;
create trigger contract_files_complete_pending_intent after insert on public.contract_files
  for each row execute function public.clear_completed_upload_intent();

create function public.prepare_r2_cleanup(p_limit integer default 50, p_max_attempts integer default 5)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_candidate record;
 v_intent public.pending_contract_uploads%rowtype;
 v_queued integer := 0;
 v_exhausted bigint;
begin
 if p_limit is null or p_max_attempts is null
    or p_limit not between 1 and 200 or p_max_attempts not between 1 and 20 then
   raise exception 'Invalid cleanup bounds' using errcode='22023';
 end if;
 for v_candidate in select object_key from public.pending_contract_uploads
   where expires_at < now() order by expires_at limit p_limit
 loop
   -- Match completion's object-key lock before taking an intent row lock.
   if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('r2-object:' || v_candidate.object_key,0)) then
     continue;
   end if;
   select * into v_intent from public.pending_contract_uploads
     where object_key=v_candidate.object_key and expires_at < now() for update skip locked;
   if not found then continue; end if;
   if not exists (select 1 from public.contract_files f where f.object_key=v_intent.object_key)
      and not exists (select 1 from public.r2_cleanup_queue q where q.object_key=v_intent.object_key) then
     insert into public.r2_cleanup_queue(object_key,reason,status,attempts,last_error)
       values(v_intent.object_key,'reconciliation','pending',0,'Abandoned upload reservation expired');
     v_queued := v_queued + 1;
   end if;
   delete from public.pending_contract_uploads where object_key=v_intent.object_key;
 end loop;
 select count(*) into v_exhausted from public.r2_cleanup_queue
   where status in ('pending','failed','processing') and attempts >= p_max_attempts;
 return jsonb_build_object('queued',v_queued,'exhausted',v_exhausted);
end;
$$;
revoke all on function public.register_contract_upload_intent(text,uuid,uuid,uuid,uuid),
  public.clear_completed_upload_intent(), public.prepare_r2_cleanup(integer,integer)
  from public, anon, authenticated;
grant execute on function public.register_contract_upload_intent(text,uuid,uuid,uuid,uuid),
  public.prepare_r2_cleanup(integer,integer) to service_role;
