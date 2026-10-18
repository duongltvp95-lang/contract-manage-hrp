-- Migration: Harden consume_rate_limit RPC against parameter abuse
-- Restricts p_bucket to known endpoints and bounds p_limit/p_window_seconds.

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

  -- Validate bucket strictly against known endpoint buckets
  if p_bucket is null or p_bucket not in ('files:upload-url', 'files:view-url', 'ai:upload-url') then
    return query select false, 0, now();
    return;
  end if;

  -- Enforce application's fixed policy (exactly 60 requests per 60-second window).
  -- Reject any deviating parameters to prevent authenticated clients from arbitrarily
  -- creating multiple counter rows with different windows or limits.
  if coalesce(p_limit, 60) <> 60 or coalesce(p_window_seconds, 60) <> 60 then
    return query select false, 0, now();
    return;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / 60) * 60
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
     and window_start < v_window_start - interval '120 seconds';

  return query
    select v_hits <= 60,
           greatest(60 - v_hits, 0),
           v_window_start + interval '60 seconds';
end;
$$;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Atomically counts one request for auth.uid() with bounded parameters and validated buckets.';
