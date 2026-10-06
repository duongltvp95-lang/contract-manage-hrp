-- W5-USER-001 — profiles.is_tombstone (round 5)
--
-- The "người dùng đã xoá" placeholder profile that audit_logs.actor_id
-- points at after a user is hard-deleted. It is a real auth.users + profiles
-- row (see lib/services/users.ts → ensureTombstoneProfile), which is why
-- listUsers() would otherwise surface it on /settings. The flag is a
-- separate concept from is_active:
--   - is_active=false: real user that an admin chose to deactivate
--     (round 3 — surfaced on /settings with a badge).
--   - is_tombstone=true: the system-managed placeholder; never shown.
--
-- Tombstone rows are UPSERTed by the service with is_tombstone=true. The
-- service is the only writer of this column (RLS does not block service_role),
-- so the default of `false` is safe for every existing row. A backfill is
-- not included: T1/Owner runs a one-line UPDATE on production against the
-- single tombstone id from round 4 (`81c03089-de31-4799-9361-ead99bc525f3`),
-- and any future tombstone row is created with is_tombstone=true by the
-- service on the first delete that needs it.

alter table public.profiles
  add column if not exists is_tombstone boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_is_tombstone_check;

alter table public.profiles
  add constraint profiles_is_tombstone_check
  check (is_tombstone in (true, false));

comment on column public.profiles.is_tombstone is
  'True for the single system-managed tombstone row that replaces the actor on a hard delete. Never shown in /settings.';
