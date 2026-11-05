create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
-- Match Supabase's explicit API-role defaults, not only PostgreSQL's PUBLIC grant.
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
create schema auth;
create schema extensions;
alter database postgres set search_path = public, extensions;
create table auth.users (
  id uuid primary key, email text unique,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('sub', auth.uid(), 'role', auth.role(),
    'aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal1'));
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
