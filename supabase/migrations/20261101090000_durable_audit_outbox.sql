-- External events must be durably accepted before login/export reports success.
create table public.audit_event_outbox (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('admin','user')),
  action text not null,
  target_kind text not null,
  target_id uuid,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
  occurred_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  completed_at timestamptz
);
alter table public.audit_event_outbox enable row level security;
revoke all on public.audit_event_outbox from public, anon, authenticated;
grant all on public.audit_event_outbox to service_role;
create index audit_event_outbox_pending_idx on public.audit_event_outbox(next_attempt_at,occurred_at)
 where completed_at is null;

create function public.deliver_audit_event(p_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
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
  v_metadata := v_event.metadata;
  if not exists (select 1 from public.profiles where id=v_actor and organization_id=v_event.organization_id) then
   select id into v_actor from public.profiles
    where organization_id=v_event.organization_id and is_tombstone order by id limit 1;
   if v_actor is null then raise exception 'Historical audit actor unavailable' using errcode='23503'; end if;
   v_metadata := v_metadata || jsonb_build_object('originalActorId',v_event.actor_id);
  end if;
  insert into public.audit_logs(id,organization_id,actor_id,actor_role,action,target_kind,target_id,metadata,created_at)
   values(v_event.id,v_event.organization_id,v_actor,v_event.actor_role,v_event.action,v_event.target_kind,
     v_event.target_id,v_metadata,v_event.occurred_at)
   on conflict (id) do nothing;
  update public.audit_event_outbox set completed_at=now(),attempts=attempts+1,last_error=null where id=p_id;
  return true;
 exception when others then
  -- Only the attempted delivery rolls back; the accepted event remains durable.
  update public.audit_event_outbox set attempts=attempts+1,last_error=sqlstate,
   next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer))
   where id=p_id;
  return false;
 end;
end;
$$;

create function public.enqueue_audit_event(
 p_id uuid,p_organization_id uuid,p_actor_id uuid,p_actor_role text,p_action text,
 p_target_kind text,p_target_id uuid,p_metadata jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_existing public.audit_event_outbox%rowtype; v_delivered boolean;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'Server audit credentials required' using errcode='42501';
 end if;
 if p_id is null or p_actor_role not in ('admin','user')
  or p_action not in ('create_user','update_user_role','set_active_user','delete_user','export_logs',
   'create_partner','update_partner','import_partners','create_contract','update_contract','archive_contract',
   'upload_file','update_profile','set_partner_status','delete_contract','delete_partner','unarchive_contract',
   'export_partners','verify_mfa','login','logout','view_file','delete_file')
  or p_target_kind not in ('user','logs','partner','contract','file','profile')
  or p_metadata is null or jsonb_typeof(p_metadata)<>'object' or pg_column_size(p_metadata)>65536
  or not exists(select 1 from public.profiles where id=p_actor_id and organization_id=p_organization_id) then
  raise exception 'Invalid audit event' using errcode='22023';
 end if;
 insert into public.audit_event_outbox(id,organization_id,actor_id,actor_role,action,target_kind,target_id,metadata)
  values(p_id,p_organization_id,p_actor_id,p_actor_role,p_action,p_target_kind,p_target_id,p_metadata)
  on conflict (id) do nothing;
 select * into v_existing from public.audit_event_outbox where id=p_id for update;
 if v_existing.organization_id is distinct from p_organization_id or v_existing.actor_id is distinct from p_actor_id
  or v_existing.actor_role is distinct from p_actor_role or v_existing.action is distinct from p_action
  or v_existing.target_kind is distinct from p_target_kind or v_existing.target_id is distinct from p_target_id
  or v_existing.metadata is distinct from p_metadata then
  raise exception 'Audit event identity already used' using errcode='23505';
 end if;
 if v_existing.completed_at is not null then v_delivered := true;
 elsif v_existing.attempts=0 then v_delivered := public.deliver_audit_event(p_id);
 else v_delivered := false;
 end if;
 return jsonb_build_object('id',p_id,'delivered',v_delivered);
end;
$$;

create function public.process_audit_event_outbox(p_limit integer default 100,p_max_attempts integer default 8)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_event record; v_processed integer:=0; v_succeeded integer:=0; v_exhausted bigint;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'Server audit credentials required' using errcode='42501';
 end if;
 if p_limit is null or p_limit not between 1 and 200 or p_max_attempts is null or p_max_attempts not between 1 and 20 then
  raise exception 'Invalid audit retry bounds' using errcode='22023';
 end if;
 for v_event in select id from public.audit_event_outbox
  where completed_at is null and attempts<p_max_attempts and next_attempt_at<=now()
  order by occurred_at limit p_limit for update skip locked
 loop
  v_processed:=v_processed+1;
  if public.deliver_audit_event(v_event.id) then v_succeeded:=v_succeeded+1; end if;
 end loop;
 select count(*) into v_exhausted from public.audit_event_outbox where completed_at is null and attempts>=p_max_attempts;
 -- Completed rows are delivery receipts; keep 30 days for idempotent retries.
 delete from public.audit_event_outbox where completed_at<now()-interval '30 days';
 return jsonb_build_object('processed',v_processed,'succeeded',v_succeeded,
  'failed',v_processed-v_succeeded,'exhausted',v_exhausted);
end;
$$;
revoke all on function public.deliver_audit_event(uuid),
 public.enqueue_audit_event(uuid,uuid,uuid,text,text,text,uuid,jsonb),public.process_audit_event_outbox(integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.enqueue_audit_event(uuid,uuid,uuid,text,text,text,uuid,jsonb),
 public.process_audit_event_outbox(integer,integer) to service_role;
