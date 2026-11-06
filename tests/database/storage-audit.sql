set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='aaaaaaaa-0000-4000-8000-000000000001';
do $$
begin
 begin
  insert into public.contract_files(organization_id,contract_id,bucket,object_key,original_filename,mime_type)
   values('11111111-1111-1111-1111-111111111111','cccccccc-0000-4000-8000-000000000001','test','fake','fake.pdf','application/pdf');
  raise exception 'Direct INSERT unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;
update public.contracts set notes='Direct Data API change',expiry_date='2027-01-01'
 where id='cccccccc-0000-4000-8000-000000000001';
reset role;
set request.jwt.claim.role='service_role';
select public.test_assert(exists(
 select 1 from public.audit_logs where actor_id='aaaaaaaa-0000-4000-8000-000000000001'
  and target_id='cccccccc-0000-4000-8000-000000000001' and action='update_contract'
  and metadata->'changed' ? 'notes'
), 'direct authenticated writes have durable audit');
select public.test_assert(not has_function_privilege('authenticated',
 'public.append_transaction_audit(uuid,uuid,text,text,uuid,jsonb)','execute'), 'clients cannot forge audit');

-- Simulate an audit persistence failure: the business write must roll back too.
create function public.test_reject_audit() returns trigger language plpgsql as $$
begin raise exception 'Injected audit failure' using errcode='23514'; end $$;
create trigger test_reject_audit before insert or update on public.audit_logs
 for each row execute function public.test_reject_audit();
set role authenticated;
set request.jwt.claim.role='authenticated';
do $$
begin
 begin
  update public.contracts set notes='Must roll back with audit'
   where id='cccccccc-0000-4000-8000-000000000001';
  raise exception 'Audit failure did not abort business write';
 exception when check_violation then null;
 end;
end $$;
reset role;
set request.jwt.claim.role='service_role';
select public.test_assert((select notes='Direct Data API change' from public.contracts
 where id='cccccccc-0000-4000-8000-000000000001'), 'audit failure rolls back business write');
drop trigger test_reject_audit on public.audit_logs;
drop function public.test_reject_audit();

do $$
begin
  begin
    perform public.register_contract_upload_intent(
      'contracts/11111111-1111-1111-1111-111111111111/cccccccc-0000-4000-8000-000000000001/ffffffff-0000-4000-8000-000000000001/canonical-forbidden.pdf',
      'ffffffff-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
      'cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001');
    raise exception 'Canonical contracts/ key unexpectedly accepted as upload intent';
  exception when invalid_parameter_value then null;
  end;
end $$;

select public.register_contract_upload_intent(
 'uploads-staging/11111111-1111-1111-1111-111111111111/cccccccc-0000-4000-8000-000000000001/ffffffff-0000-4000-8000-000000000001/abandoned.pdf',
 'ffffffff-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
 'cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001');
update public.pending_contract_uploads set expires_at=now()-interval '1 minute';
select public.test_assert((public.prepare_r2_cleanup(50,5)->>'queued')::int=1,
 'abandoned upload is queued without completeUpload');
select public.test_assert((select count(*)=0 from public.pending_contract_uploads), 'expired intent reconciled');
select public.test_assert(not public.register_contract_upload_intent(
 'uploads-staging/11111111-1111-1111-1111-111111111111/cccccccc-0000-4000-8000-000000000001/ffffffff-0000-4000-8000-000000000001/abandoned.pdf',
 'ffffffff-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
 'cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001'),
 'cleanup tombstone cannot receive a refreshed PUT URL');
select public.register_contract_upload_intent(
 'uploads-staging/11111111-1111-1111-1111-111111111111/cccccccc-0000-4000-8000-000000000001/ffffffff-0000-4000-8000-000000000002/saved.pdf',
 'ffffffff-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111',
 'cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001');
select public.complete_contract_file_upload(
 'ffffffff-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111',
 'cccccccc-0000-4000-8000-000000000001',
 'contracts/11111111-1111-1111-1111-111111111111/cccccccc-0000-4000-8000-000000000001/ffffffff-0000-4000-8000-000000000002/saved.pdf',
 'test','saved.pdf','application/pdf',123,null,'aaaaaaaa-0000-4000-8000-000000000001','document');
select public.test_assert((select count(*)=0 from public.pending_contract_uploads), 'completion clears intent transactionally');
select public.test_assert((select count(*)=1 from public.audit_logs
 where target_id='ffffffff-0000-4000-8000-000000000002' and action='upload_file'),
 'file persistence creates durable upload audit');
with created as (
 insert into public.contracts(organization_id,contract_number)
 select '11111111-1111-1111-1111-111111111111','LARGE-FILES-'||n from generate_series(1,1200) n returning id
)
insert into public.contract_files(organization_id,contract_id,bucket,object_key,original_filename,mime_type)
 select '11111111-1111-1111-1111-111111111111',id,'test','large/'||id,'doc.pdf','application/pdf' from created;
select public.test_assert((select count(*)=1200 from public.contract_listing
 where contract_number like 'LARGE-FILES-%' and has_files and file_count=1),
 'listing counts all files beyond Data API row limits');
with created as (
 insert into public.partners(organization_id,name)
 select '11111111-1111-1111-1111-111111111111','SHARED-SEARCH-'||n from generate_series(1,160) n returning id
)
insert into public.contracts(organization_id,contract_number,partner_id)
 select '11111111-1111-1111-1111-111111111111','SEARCH-CONTRACT-'||id,id from created;
select public.test_assert((select count(*)=160 from public.contract_listing
 where partner_name ilike '%SHARED-SEARCH-%'), 'joined partner search has no 150-ID cap');
select 'PASS durable audit, upload intents, 1200-file count and 160-partner search';
