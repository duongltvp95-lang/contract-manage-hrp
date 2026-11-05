-- TEST PROJECT ONLY. This marker must never be installed on production.
create table public.hrp_test_environment (
  id integer primary key check (id=1),
  purpose text not null check (purpose='hrp-isolated-tests')
);
alter table public.hrp_test_environment enable row level security;
revoke all on public.hrp_test_environment from public, anon, authenticated;
grant select on public.hrp_test_environment to service_role;
insert into public.hrp_test_environment values (1,'hrp-isolated-tests');
