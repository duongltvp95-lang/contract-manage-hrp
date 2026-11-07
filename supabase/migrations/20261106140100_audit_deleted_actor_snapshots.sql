-- A06: Preserve historical actor attribution snapshots when deleting a user
-- and allow safe rollback if GoTrue deletion fails mid-flight.

alter table public.audit_logs
  add column if not exists deleted_actor_id uuid,
  add column if not exists actor_name_snapshot text,
  add column if not exists actor_email_snapshot text;

alter table public.audit_event_outbox
  add column if not exists actor_name_snapshot text,
  add column if not exists actor_email_snapshot text;

create or replace function public.deliver_audit_event(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.audit_event_outbox%rowtype;
  v_actor uuid;
  v_deleted_actor uuid := null;
  v_metadata jsonb;
begin
  select * into v_event from public.audit_event_outbox where id = p_id for update;
  if not found then
    raise exception 'Audit event unavailable' using errcode = '22023';
  end if;
  if v_event.completed_at is not null then
    return true;
  end if;

  begin
    v_actor := v_event.actor_id;
    v_metadata := v_event.metadata;
    if not exists (
      select 1
        from public.profiles
       where id = v_actor
         and organization_id = v_event.organization_id
    ) then
      select id
        into v_actor
        from public.profiles
       where organization_id = v_event.organization_id
         and is_tombstone
       order by id
       limit 1;
      if v_actor is null then
        raise exception 'Historical audit actor unavailable' using errcode = '23503';
      end if;
      v_deleted_actor := v_event.actor_id;
      v_metadata := v_metadata || jsonb_build_object('originalActorId', v_event.actor_id);
    end if;

    insert into public.audit_logs (
      id,
      organization_id,
      actor_id,
      actor_role,
      action,
      target_kind,
      target_id,
      metadata,
      created_at,
      deleted_actor_id,
      actor_name_snapshot,
      actor_email_snapshot
    ) values (
      v_event.id,
      v_event.organization_id,
      v_actor,
      v_event.actor_role,
      v_event.action,
      v_event.target_kind,
      v_event.target_id,
      v_metadata,
      v_event.occurred_at,
      v_deleted_actor,
      v_event.actor_name_snapshot,
      v_event.actor_email_snapshot
    )
    on conflict (id) do nothing;

    update public.audit_event_outbox
       set completed_at = now(),
           attempts = attempts + 1,
           last_error = null
     where id = p_id;
    return true;
  exception when others then
    update public.audit_event_outbox
       set attempts = attempts + 1,
           last_error = sqlstate,
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempts, 7))::integer))
     where id = p_id;
    return false;
  end;
end;
$$;

revoke all on function public.deliver_audit_event(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.prepare_actor_audit_for_user_delete(
  p_organization_id uuid,
  p_user_id uuid,
  p_tombstone_id uuid,
  p_actor_name text default null,
  p_actor_email text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repointed integer := 0;
  v_name text := nullif(btrim(coalesce(p_actor_name, '')), '');
  v_email text := nullif(btrim(coalesce(p_actor_email, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server credentials required' using errcode = '42501';
  end if;

  if p_organization_id is null or p_user_id is null or p_tombstone_id is null or p_user_id = p_tombstone_id then
    raise exception 'Invalid user delete audit arguments' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.profiles
     where id = p_tombstone_id
       and organization_id = p_organization_id
       and is_tombstone = true
  ) then
    raise exception 'Tombstone profile not found for organization' using errcode = '23503';
  end if;

  update public.audit_logs
     set deleted_actor_id = coalesce(deleted_actor_id, actor_id),
         actor_name_snapshot = coalesce(actor_name_snapshot, v_name),
         actor_email_snapshot = coalesce(actor_email_snapshot, v_email),
         actor_id = p_tombstone_id
   where organization_id = p_organization_id
     and actor_id = p_user_id;

  get diagnostics v_repointed = row_count;

  update public.audit_event_outbox
     set actor_name_snapshot = coalesce(actor_name_snapshot, v_name),
         actor_email_snapshot = coalesce(actor_email_snapshot, v_email)
   where organization_id = p_organization_id
     and actor_id = p_user_id
     and completed_at is null;

  return v_repointed;
end;
$$;

create or replace function public.restore_actor_audit_after_failed_user_delete(
  p_organization_id uuid,
  p_user_id uuid,
  p_tombstone_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restored integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server credentials required' using errcode = '42501';
  end if;

  if p_organization_id is null or p_user_id is null or p_tombstone_id is null then
    raise exception 'Invalid user delete restore arguments' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.profiles
     where id = p_user_id
       and organization_id = p_organization_id
       and is_tombstone = false
  ) then
    return 0;
  end if;

  update public.audit_logs
     set actor_id = p_user_id,
         deleted_actor_id = null,
         actor_name_snapshot = null,
         actor_email_snapshot = null
   where organization_id = p_organization_id
     and actor_id = p_tombstone_id
     and deleted_actor_id = p_user_id;

  get diagnostics v_restored = row_count;
  return v_restored;
end;
$$;

revoke all on function public.prepare_actor_audit_for_user_delete(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_actor_audit_for_user_delete(uuid, uuid, uuid, text, text)
  to service_role;

revoke all on function public.restore_actor_audit_after_failed_user_delete(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.restore_actor_audit_after_failed_user_delete(uuid, uuid, uuid)
  to service_role;
