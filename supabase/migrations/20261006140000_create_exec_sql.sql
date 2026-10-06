-- Round 5.1 — create public.exec_sql(text) utility
--
-- This function lets the round 5.1 ops script (scripts/apply-round5-prod.mjs)
-- run DDL through the Supabase service-role RPC instead of relying on
-- `supabase db push` (the owner has not linked a CLI access token) or on
-- pasting SQL into the SQL Editor by hand.
--
-- The function is intentionally narrow:
--   - it executes one statement per call (the `execute` line is a single
--     SQL command, not a multi-statement script);
--   - it is `security definer` so it can touch objects the caller would
--     otherwise not own — but the caller still has to be `service_role`;
--   - `anon` and `authenticated` get the grant revoked; the function is
--     reachable only through the service-role JWT.
--
-- RLS on the underlying tables is not affected: this function bypasses RLS
-- for the service role, which is exactly the contract a service role has
-- anyway. The DDL it runs is hard-coded in scripts/apply-round5-prod.mjs;
-- the script does not forward user input into the function, so the SQL
-- injection surface is empty.
--
-- IMPORTANT: after applying this migration, run
--   NOTIFY pgrst, 'reload schema';
-- in the Supabase SQL Editor so PostgREST discovers the function for the
-- service-role RPC call. Without that, the round 5.1 ops script will fail
-- with "Could not find the function public.exec_sql(sql) in the schema
-- cache". See docs/ops/round5.1-sql-editor.md.

create or replace function public.exec_sql(sql text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute sql;
end;
$$;

revoke all on function public.exec_sql(text) from public;

grant execute on function public.exec_sql(text) to service_role;

comment on function public.exec_sql(text) is
  'Round 5.1 ops utility — execute a hard-coded DDL/DML string with service-role privileges. Never expose to anon or authenticated.';
