-- W1-WEB-041 hardening — per-user rate limiting for the two file API routes.
--
-- WHY A TABLE AND NOT MEMORY
--
-- Vercel runs every request in a fresh, horizontally scaled serverless instance,
-- so an in-process counter enforces nothing: a burst simply lands on different
-- instances and each one sees "1 request". The alternatives were considered and
-- rejected for this project:
--
--   * Upstash Redis (@upstash/ratelimit) — the common answer, but it adds a
--     third-party vendor, another account and another secret for two internal
--     endpoints.
--   * Vercel WAF rate limiting — a paid plan feature, configured outside the
--     repository, and it cannot key on the authenticated Supabase user id.
--   * In-memory Map — free and useless here (see above).
--
-- The database we already run wins: no new dependency, no new secret, one shared
-- counter across every instance, and the counters can be inspected with SQL when
-- something looks wrong.
--
-- FIXED WINDOW, NOT SLIDING
--
-- One row per (user, bucket, window) with an atomic upsert. That is enough for
-- "60 requests per minute" on two endpoints, and it is far easier to reason
-- about than a sliding log. The known trade-off: a caller can send up to 2x the
-- limit across a window boundary. Documented in the README.

create table if not exists public.rate_limit_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, bucket, window_start)
);

comment on table public.rate_limit_counters is
  'Fixed-window request counters for the file API routes. Pruned opportunistically by consume_rate_limit().';

create index if not exists rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;

-- Deliberately no policies: nothing reads this table directly. The function
-- below is SECURITY DEFINER and is the only way in, so a client cannot inspect
-- or reset another user's counters.
revoke all on public.rate_limit_counters from anon, authenticated;
grant all on public.rate_limit_counters to service_role;

-- ---------------------------------------------------------------------------
-- consume_rate_limit — count one request for the CALLING user.
--
-- The user id is taken from auth.uid(), never from an argument: a parameter
-- would let any authenticated caller burn another user's quota.
-- ---------------------------------------------------------------------------

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_window_start timestamptz;
  v_hits integer;
begin
  -- Unauthenticated callers never reach a route (proxy.ts answers 401 first);
  -- this branch is a safety net rather than a normal path.
  if v_user_id is null then
    return query select false, 0, now();
    return;
  end if;

  if p_limit is null or p_limit <= 0 or p_window_seconds is null or p_window_seconds <= 0 then
    return query select false, 0, now();
    return;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_counters (user_id, bucket, window_start, hits)
  values (v_user_id, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
    do update set hits = public.rate_limit_counters.hits + 1
  returning hits into v_hits;

  -- Opportunistic prune, scoped to this caller, so the table stays small
  -- without needing pg_cron.
  delete from public.rate_limit_counters
   where user_id = v_user_id
     and bucket = p_bucket
     and window_start < v_window_start - make_interval(secs => p_window_seconds * 2);

  return query
    select v_hits <= p_limit,
           greatest(p_limit - v_hits, 0),
           v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Atomically counts one request for auth.uid() and reports whether it is within the limit.';

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to authenticated, service_role;
