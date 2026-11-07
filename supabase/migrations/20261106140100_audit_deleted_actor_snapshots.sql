-- A06: Preserve historical actor attribution snapshots when deleting a user,
-- allow safe rollback if GoTrue deletion fails mid-flight, and round-trip
-- historical actor identity losslessly across Wave 2 DB rollback & re-apply.

alter table public.audit_logs
  add column if not exists deleted_actor_id uuid,
  add column if not exists actor_name_snapshot text,
  add column if not exists actor_email_snapshot text;

alter table public.audit_event_outbox
  add column if not exists actor_name_snapshot text,
  add column if not exists actor_email_snapshot text;

-- Backfill typed snapshot columns from metadata (or from hrp_private rollback archive if present)
-- so pre-Wave-2 outbox fallback rows and post-Wave-2-rollback rows re-hydrate with zero loss.
update public.audit_logs
   set deleted_actor_id = coalesce(
         deleted_actor_id,
         case
           when coalesce(metadata->>'deletedActorId', metadata->>'originalActorId', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then coalesce(metadata->>'deletedActorId', metadata->>'originalActorId')::uuid
           else null
         end
       ),
       actor_name_snapshot = coalesce(
         actor_name_snapshot,
         nullif(btrim(coalesce(metadata->>'actorNameSnapshot', '')), '')
       ),
       actor_email_snapshot = coalesce(
         actor_email_snapshot,
         nullif(btrim(coalesce(metadata->>'actorEmailSnapshot', '')), '')
       )
 where (
         deleted_actor_id is null
         and (metadata ? 'deletedActorId' or metadata ? 'originalActorId')
       )
    or (
         actor_name_snapshot is null
         and metadata ? 'actorNameSnapshot'
       )
    or (
         actor_email_snapshot is null
         and metadata ? 'actorEmailSnapshot'
       );

update public.audit_event_outbox
   set actor_name_snapshot = coalesce(
         actor_name_snapshot,
         nullif(btrim(coalesce(metadata->>'actorNameSnapshot', '')), '')
       ),
       actor_email_snapshot = coalesce(
         actor_email_snapshot,
         nullif(btrim(coalesce(metadata->>'actorEmailSnapshot', '')), '')
       )
 where (
         actor_name_snapshot is null
         and metadata ? 'actorNameSnapshot'
       )
    or (
         actor_email_snapshot is null
         and metadata ? 'actorEmailSnapshot'
       );

do $$
begin
  if to_regclass('hrp_private.audit_actor_snapshot_archive') is not null then
    update public.audit_logs l
       set deleted_actor_id = coalesce(l.deleted_actor_id, a.deleted_actor_id),
           actor_name_snapshot = coalesce(l.actor_name_snapshot, a.actor_name_snapshot),
           actor_email_snapshot = coalesce(l.actor_email_snapshot, a.actor_email_snapshot)
      from hrp_private.audit_actor_snapshot_archive a
     where l.id = a.log_id
       and l.organization_id = a.organization_id
       and (
         l.deleted_actor_id is null
         or l.actor_name_snapshot is null
         or l.actor_email_snapshot is null
       );
  end if;

  if to_regclass('hrp_private.audit_outbox_snapshot_archive') is not null then
    update public.audit_event_outbox o
       set actor_name_snapshot = coalesce(o.actor_name_snapshot, a.actor_name_snapshot),
           actor_email_snapshot = coalesce(o.actor_email_snapshot, a.actor_email_snapshot)
      from hrp_private.audit_outbox_snapshot_archive a
     where o.id = a.event_id
       and o.organization_id = a.organization_id
       and (
         o.actor_name_snapshot is null
         or o.actor_email_snapshot is null
       );
  end if;
end $$;

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
  v_name_snapshot text;
  v_email_snapshot text;
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
    v_metadata := coalesce(v_event.metadata, '{}'::jsonb);
    v_name_snapshot := coalesce(
      v_event.actor_name_snapshot,
      nullif(btrim(coalesce(v_metadata->>'actorNameSnapshot', '')), '')
    );
    v_email_snapshot := coalesce(
      v_event.actor_email_snapshot,
      nullif(btrim(coalesce(v_metadata->>'actorEmailSnapshot', '')), '')
    );

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
      v_metadata := v_metadata || pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'originalActorId', v_event.actor_id,
          'deletedActorId', v_event.actor_id,
          'actorNameSnapshot', v_name_snapshot,
          'actorEmailSnapshot', v_email_snapshot
        )
      );
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
      v_name_snapshot,
      v_email_snapshot
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
         metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_strip_nulls(
           pg_catalog.jsonb_build_object(
             'deletedActorId', coalesce(deleted_actor_id, actor_id)::text,
             'originalActorId', coalesce(deleted_actor_id, actor_id)::text,
             'actorNameSnapshot', coalesce(actor_name_snapshot, v_name),
             'actorEmailSnapshot', coalesce(actor_email_snapshot, v_email)
           )
         ),
         actor_id = p_tombstone_id
   where organization_id = p_organization_id
     and actor_id = p_user_id;

  get diagnostics v_repointed = row_count;

  update public.audit_event_outbox
     set actor_name_snapshot = coalesce(actor_name_snapshot, v_name),
         actor_email_snapshot = coalesce(actor_email_snapshot, v_email),
         metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_strip_nulls(
           pg_catalog.jsonb_build_object(
             'actorNameSnapshot', coalesce(actor_name_snapshot, v_name),
             'actorEmailSnapshot', coalesce(actor_email_snapshot, v_email)
           )
         )
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
         actor_email_snapshot = null,
         metadata = coalesce(metadata, '{}'::jsonb)
           - 'deletedActorId'
           - 'originalActorId'
           - 'actorNameSnapshot'
           - 'actorEmailSnapshot'
   where organization_id = p_organization_id
     and actor_id = p_tombstone_id
     and deleted_actor_id = p_user_id;

  get diagnostics v_restored = row_count;

  update public.audit_event_outbox
     set actor_name_snapshot = null,
         actor_email_snapshot = null,
         metadata = coalesce(metadata, '{}'::jsonb)
           - 'actorNameSnapshot'
           - 'actorEmailSnapshot'
   where organization_id = p_organization_id
     and actor_id = p_user_id
     and completed_at is null;

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
