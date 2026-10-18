-- Migration: R2 orphan objects cleanup outbox / queue
-- Tracks failed R2 deletions and upload compensation cleanups for durable retries and reconciliation.

create table if not exists public.r2_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  object_key text not null,
  reason text not null check (reason in ('file_deleted', 'upload_db_failed', 'reconciliation')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.r2_cleanup_queue is
  'Durable outbox for R2 objects requiring asynchronous deletion or retry after partial operation failures.';

create index if not exists r2_cleanup_queue_status_idx
  on public.r2_cleanup_queue (status, created_at);

create index if not exists r2_cleanup_queue_object_key_idx
  on public.r2_cleanup_queue (object_key);

alter table public.r2_cleanup_queue enable row level security;

-- Restricted to service_role client only (internal maintenance and retry mechanisms)
revoke all on public.r2_cleanup_queue from public, anon, authenticated;
grant all on public.r2_cleanup_queue to service_role;
