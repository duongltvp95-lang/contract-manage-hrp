-- Give paid Gemini extraction its own per-user budget. Upload URL issuance is
-- rate-limited separately and does not count as an inference request.
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
  v_expected_limit integer;
begin
  if v_user_id is null then
    return query select false, 0, now();
    return;
  end if;

  if p_bucket is null or p_bucket not in (
    'files:upload-url',
    'files:view-url',
    'ai:upload-url',
    'ai:extract'
  ) then
    return query select false, 0, now();
    return;
  end if;

  v_expected_limit := case when p_bucket = 'ai:extract' then 10 else 60 end;
  if coalesce(p_limit, v_expected_limit) <> v_expected_limit
     or coalesce(p_window_seconds, 60) <> 60 then
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

  delete from public.rate_limit_counters
   where user_id = v_user_id
     and bucket = p_bucket
     and window_start < v_window_start - interval '120 seconds';

  return query
    select v_hits <= v_expected_limit,
           greatest(v_expected_limit - v_hits, 0),
           v_window_start + interval '60 seconds';
end;
$$;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Atomically counts authenticated requests: 60/min for file endpoints and 10/min for AI extraction.';
