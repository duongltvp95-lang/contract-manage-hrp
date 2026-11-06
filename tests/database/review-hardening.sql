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
select public.test_assert(not has_function_privilege('anon','public.exec_sql(text)','execute')
 and not has_function_privilege('authenticated','public.exec_sql(text)','execute'),
 'operational SQL RPC revokes explicit Supabase API-role grants');
select public.claim_login_attempt(repeat('a',64)) from generate_series(1,4);
select public.test_assert(
 (public.claim_login_attempt(repeat('a',64))->>'allowed')::boolean=false, 'sixth attempt blocked without cookies');
select public.clear_login_attempts(repeat('a',64));
select public.test_assert(
 (public.claim_login_attempt(repeat('a',64))->>'remaining')::int=4, 'successful login budget can reset');

-- A01: archived contracts & file metadata RLS + dedicated archive RPC
insert into auth.users(id, email) values ('aaaaaaaa-0000-4000-8000-000000000003', 'priv@test.invalid');
update public.profiles set role='admin', can_manage_archived=true where id='aaaaaaaa-0000-4000-8000-000000000003';
insert into public.contracts(id, organization_id, contract_number, notes, archived_at)
 values ('cccccccc-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111','ARCHIVED-SECRET','SECRET-NOTE',now()),
        ('cccccccc-0000-4000-8000-000000000003','11111111-1111-1111-1111-111111111111','TO-ARCHIVE','ACTIVE-NOTE',null);
insert into public.contract_files(id, organization_id, contract_id, bucket, object_key, original_filename, mime_type)
 values ('ffffffff-0000-4000-8000-000000000099','11111111-1111-1111-1111-111111111111',
         'cccccccc-0000-4000-8000-000000000002','test','contracts/11111111-1111-1111-1111-111111111111/cccccccc-0000-4000-8000-000000000002/ffffffff-0000-4000-8000-000000000099/secret.pdf','secret.pdf','application/pdf');

set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='aaaaaaaa-0000-4000-8000-000000000001';
select public.test_assert((select count(*)=0 from public.contracts where id='cccccccc-0000-4000-8000-000000000002'),
 'A01: non-privileged user cannot SELECT archived contract');
select public.test_assert((select count(*)=0 from public.contract_files where id='ffffffff-0000-4000-8000-000000000099'),
 'A01: non-privileged user cannot SELECT archived contract file metadata');
select public.test_assert(public.get_contract_archive_state('cccccccc-0000-4000-8000-000000000002')='archived',
 'A01: minimal archive state RPC reports archived for same-org contract without leaking fields');
do $$
begin
  begin
    update public.profiles set can_manage_archived=true where id='aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'Client unexpectedly updated can_manage_archived';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.test_assert((public.archive_contract_atomic('cccccccc-0000-4000-8000-000000000003')->>'status')='archived',
 'A01: non-privileged user can archive active contract via dedicated RPC');
select public.test_assert((select count(*)=0 from public.contracts where id='cccccccc-0000-4000-8000-000000000003'),
 'A01: newly archived contract becomes hidden from non-privileged SELECT');

set request.jwt.claim.sub='aaaaaaaa-0000-4000-8000-000000000003';
select public.test_assert((select count(*)=2 from public.contracts where id in ('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003')),
 'A01: privileged user with can_manage_archived=true can SELECT archived contracts');
select public.test_assert((select count(*)=1 from public.contract_files where id='ffffffff-0000-4000-8000-000000000099'),
 'A01: privileged user with can_manage_archived=true can SELECT archived contract files');
reset role;
set request.jwt.claim.role='service_role';

-- A02: composite tenant FKs, valid date ordering, and created_by invariants
insert into public.partners(id, organization_id, name)
 values ('dddddddd-0000-4000-8000-000000000099','22222222-2222-2222-2222-222222222222','Other tenant partner');
insert into public.companies(id, organization_id, name)
 values ('eeeeeeee-0000-4000-8000-000000000099','22222222-2222-2222-2222-222222222222','Other tenant company'),
        ('eeeeeeee-0000-4000-8000-000000000098','11111111-1111-1111-1111-111111111111','Disposable company');

do $$
begin
  begin
    insert into public.contracts(organization_id, contract_number, partner_id)
      values ('11111111-1111-1111-1111-111111111111','CROSS-PARTNER','dddddddd-0000-4000-8000-000000000099');
    raise exception 'Cross-tenant partner link unexpectedly succeeded';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.contracts(organization_id, contract_number, company_id)
      values ('11111111-1111-1111-1111-111111111111','CROSS-COMPANY','eeeeeeee-0000-4000-8000-000000000099');
    raise exception 'Cross-tenant company link unexpectedly succeeded';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.contracts(organization_id, contract_number, signed_date, expiry_date)
      values ('11111111-1111-1111-1111-111111111111','BAD-DATE','2026-06-01','2026-01-01');
    raise exception 'Expiry before signed_date unexpectedly succeeded';
  exception when check_violation then null;
  end;
end $$;

set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='aaaaaaaa-0000-4000-8000-000000000001';
do $$
begin
  begin
    insert into public.contracts(organization_id, contract_number, created_by)
      values ('11111111-1111-1111-1111-111111111111','FORGED-CREATOR','aaaaaaaa-0000-4000-8000-000000000003');
    raise exception 'Forged created_by unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into public.contracts(id, organization_id, contract_number, company_id)
 values ('cccccccc-0000-4000-8000-000000000004','11111111-1111-1111-1111-111111111111','COMPANY-SET-NULL','eeeeeeee-0000-4000-8000-000000000098');
do $$
begin
  begin
    update public.contracts set created_by='aaaaaaaa-0000-4000-8000-000000000003'
      where id='cccccccc-0000-4000-8000-000000000004';
    raise exception 'Direct created_by mutation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set request.jwt.claim.role='service_role';

delete from public.companies where id='eeeeeeee-0000-4000-8000-000000000098';
select public.test_assert((select company_id is null and organization_id='11111111-1111-1111-1111-111111111111'
 from public.contracts where id='cccccccc-0000-4000-8000-000000000004'),
 'A02: deleting a company nulls only company_id while preserving organization_id');
delete from public.contract_files where id='ffffffff-0000-4000-8000-000000000099';
delete from public.contracts where id in (
 'cccccccc-0000-4000-8000-000000000002',
 'cccccccc-0000-4000-8000-000000000003',
 'cccccccc-0000-4000-8000-000000000004'
);

select 'PASS RLS, atomic partner rollback, login budget, listing and file privileges';
