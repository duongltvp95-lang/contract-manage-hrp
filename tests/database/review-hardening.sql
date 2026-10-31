create function public.test_assert(ok boolean, label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS %', label;
end;
$$;
insert into public.organizations(id, name)
 values ('22222222-2222-2222-2222-222222222222', 'Other test tenant');
insert into auth.users(id, email) values
 ('aaaaaaaa-0000-4000-8000-000000000001', 'active@test.invalid'),
 ('aaaaaaaa-0000-4000-8000-000000000002', 'disabled@test.invalid'),
 ('bbbbbbbb-0000-4000-8000-000000000001', 'other@test.invalid');
update public.profiles set is_active=false where id='aaaaaaaa-0000-4000-8000-000000000002';
update public.profiles set organization_id='22222222-2222-2222-2222-222222222222'
 where id='bbbbbbbb-0000-4000-8000-000000000001';
insert into public.contracts(id, organization_id, contract_number)
 values ('cccccccc-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','LOCAL-TEST');

set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='aaaaaaaa-0000-4000-8000-000000000002';
select public.test_assert(public.current_organization_id() is null, 'disabled JWT has no tenant');
select public.test_assert((select count(*)=0 from public.contracts), 'disabled JWT cannot read contracts');
do $$
begin
  begin
    insert into public.contracts(organization_id, contract_number)
      values ('11111111-1111-1111-1111-111111111111','MUST-NOT-WRITE');
    raise exception 'disabled insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub='aaaaaaaa-0000-4000-8000-000000000001';
select public.test_assert((select count(*)=1 from public.contracts), 'active JWT sees own contracts');
select public.test_assert(not has_table_privilege('authenticated','public.contract_files','insert'), 'direct file INSERT revoked');
set request.jwt.claim.sub='bbbbbbbb-0000-4000-8000-000000000001';
select public.test_assert((select count(*)=0 from public.contract_listing), 'listing view preserves tenant RLS');
reset role;
set request.jwt.claim.role='service_role';

insert into public.partners(id, organization_id, name) values
 ('dddddddd-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','Original partner');
insert into public.partner_companies(partner_id, company_id)
 values ('dddddddd-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
create function public.test_reject_link() returns trigger language plpgsql as $$
begin
 if new.company_id='00000000-0000-4000-8000-000000000002' then
   raise exception 'Injected link failure' using errcode='23514';
 end if;
 return new;
end $$;
create trigger test_reject_link before insert on public.partner_companies
 for each row execute function public.test_reject_link();
set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='aaaaaaaa-0000-4000-8000-000000000001';
do $$
begin
 begin
  perform public.update_partner_atomic(
   'dddddddd-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
   '{"name":"Must roll back"}','{00000000-0000-4000-8000-000000000002}'::uuid[]);
  raise exception 'Injected failure did not occur';
 exception when check_violation then null;
 end;
end $$;
select public.test_assert((select name='Original partner' from public.partners
 where id='dddddddd-0000-4000-8000-000000000001'), 'failed atomic update preserves partner fields');
select public.test_assert((select count(*)=1 and bool_and(company_id='00000000-0000-4000-8000-000000000001')
 from public.partner_companies where partner_id='dddddddd-0000-4000-8000-000000000001'), 'failed atomic update preserves old companies');
reset role;
set request.jwt.claim.role='service_role';
drop trigger test_reject_link on public.partner_companies;
set role authenticated;
set request.jwt.claim.role='authenticated';
select public.update_partner_atomic(
 'dddddddd-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
 '{"name":"Saved partner"}','{00000000-0000-4000-8000-000000000002,00000000-0000-4000-8000-000000000002}'::uuid[]);
select public.test_assert((select count(*)=1 from public.partner_companies
 where partner_id='dddddddd-0000-4000-8000-000000000001'), 'atomic update de-duplicates company IDs');
reset role;
set request.jwt.claim.role='service_role';

select public.test_assert(
 (public.claim_login_attempt(repeat('a',64))->>'remaining')::int=4, 'login attempt stored server-side');
select public.test_assert(not has_function_privilege('authenticated',
 'public.complete_contract_file_upload(uuid,uuid,uuid,text,text,text,text,bigint,text,uuid,text)', 'EXECUTE'),
 'authenticated callers cannot bypass R2 verification through the completion RPC');
select public.claim_login_attempt(repeat('a',64)) from generate_series(1,4);
select public.test_assert(
 (public.claim_login_attempt(repeat('a',64))->>'allowed')::boolean=false, 'sixth attempt blocked without cookies');
select public.clear_login_attempts(repeat('a',64));
select public.test_assert(
 (public.claim_login_attempt(repeat('a',64))->>'remaining')::int=4, 'successful login budget can reset');
select 'PASS RLS, atomic partner rollback, login budget, listing and file privileges';
