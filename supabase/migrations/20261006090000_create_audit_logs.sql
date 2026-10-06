-- W3-ADMIN-001 — audit_logs (round 3, part 1)
--
-- Append-only log of privileged actions performed by an administrator.
-- Read-only for the same administrators; nothing for the regular user.
-- Written by lib/services/audit-logs.ts (server-side, service_role) and
-- surfaced at /admin/logs (round 3, part 4 — admin only).

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  actor_role text not null,
  action text not null,
  target_kind text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_actor_role_check check (actor_role in ('admin', 'user')),
  constraint audit_logs_action_check check (
    action in (
      'create_user',
      'update_user_role',
      'set_active_user',
      'delete_user',
      'export_logs'
    )
  ),
  constraint audit_logs_target_kind_check check (
    target_kind in ('user', 'logs')
  )
);

comment on table public.audit_logs is
  'Append-only log of privileged actions (admin scope). Surfaced at /admin/logs.';

comment on column public.audit_logs.actor_id is
  'The profile that initiated the action. The owner may be deactivated later; we keep the reference (history-restricted).';

comment on column public.audit_logs.target_id is
  'The subject of the action. For delete_user this points at the deleted profile id; for export_logs the value is NULL.';

create index if not exists audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);

create index if not exists audit_logs_actor_created_idx
  on public.audit_logs (actor_id, created_at desc);

create index if not exists audit_logs_target_idx
  on public.audit_logs (target_kind, target_id);

alter table public.audit_logs enable row level security;

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;

drop policy if exists audit_logs_select_admin_own_org on public.audit_logs;
create policy audit_logs_select_admin_own_org
  on public.audit_logs
  for select
  to authenticated
  using (
    organization_id = public.current_organization_id()
    and (select role from public.profiles where id = auth.uid()) = 'admin'
  );

-- No INSERT/UPDATE/DELETE policies for `authenticated`. Insert happens only
-- through the service-role client (lib/services/audit-logs.ts), and any user
-- edit would defeat the append-only invariant.
