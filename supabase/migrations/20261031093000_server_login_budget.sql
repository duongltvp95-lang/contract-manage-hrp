create table public.login_attempt_counters (
  subject_key text primary key,
  attempts integer not null,
  expires_at timestamptz not null
);
alter table public.login_attempt_counters enable row level security;
revoke all on public.login_attempt_counters from public, anon, authenticated;
grant all on public.login_attempt_counters to service_role;
create index login_attempt_counters_expiry_idx on public.login_attempt_counters (expires_at);

-- Claim before calling Auth, so concurrent requests cannot all pass a read check.
create function public.claim_login_attempt(p_subject_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_attempt public.login_attempt_counters%rowtype;
begin
  if p_subject_key is null or p_subject_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login subject key' using errcode = '22023';
  end if;
  insert into public.login_attempt_counters as counters (subject_key, attempts, expires_at)
    values (p_subject_key, 1, now() + interval '15 minutes')
  on conflict (subject_key) do update set
    attempts = case when counters.expires_at <= now() then 1 else least(counters.attempts + 1, 6) end,
    expires_at = case when counters.expires_at <= now() then now() + interval '15 minutes' else counters.expires_at end
  returning * into v_attempt;
  delete from public.login_attempt_counters
    where subject_key in (
      select subject_key from public.login_attempt_counters
      where expires_at < now() - interval '1 day' limit 100
    );
  return jsonb_build_object(
    'allowed', v_attempt.attempts <= 5,
    'remaining', greatest(0, 5 - v_attempt.attempts),
    'expires_at', v_attempt.expires_at
  );
end;
$$;
create function public.clear_login_attempts(p_subject_key text)
returns void language sql security definer set search_path = ''
as $$ delete from public.login_attempt_counters where subject_key = p_subject_key; $$;
revoke all on function public.claim_login_attempt(text) from public, anon, authenticated;
revoke all on function public.clear_login_attempts(text) from public, anon, authenticated;
grant execute on function public.claim_login_attempt(text), public.clear_login_attempts(text) to service_role;
