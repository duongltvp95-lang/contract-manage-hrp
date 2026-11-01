set request.jwt.claim.role='service_role';
create function public.test_outbox_failure() returns trigger language plpgsql as $$
begin raise exception 'Injected delivery failure' using errcode='23514'; end $$;
create trigger test_outbox_failure before insert on public.audit_logs
 for each row execute function public.test_outbox_failure();
select public.enqueue_audit_event('eeeeeeee-0000-4000-8000-000000000001',
 '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-4000-8000-000000000001',
 'admin','login','user',null,'{"source":"outbox-test"}');
select public.test_assert((select attempts=1 and completed_at is null and last_error='23514'
 from public.audit_event_outbox where id='eeeeeeee-0000-4000-8000-000000000001'),
 'failed log delivery preserves a durable retry intent');
select public.enqueue_audit_event('eeeeeeee-0000-4000-8000-000000000001',
 '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-4000-8000-000000000001',
 'admin','login','user',null,'{"source":"outbox-test"}');
select public.test_assert((select attempts=1 from public.audit_event_outbox
 where id='eeeeeeee-0000-4000-8000-000000000001'), 'lost-response retry does not duplicate or reset delivery');
select public.test_assert(not has_table_privilege('authenticated','public.audit_event_outbox','select')
 and not has_function_privilege('authenticated','public.enqueue_audit_event(uuid,uuid,uuid,text,text,text,uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.deliver_audit_event(uuid)','execute'),
 'outbox and internal delivery helper are private');
drop trigger test_outbox_failure on public.audit_logs;
update public.audit_event_outbox set next_attempt_at=now()-interval '1 second';
select public.test_assert((public.process_audit_event_outbox(100,8)->>'succeeded')::integer=1,
 'cron retries a failed delivery');
select public.enqueue_audit_event('eeeeeeee-0000-4000-8000-000000000001',
 '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-4000-8000-000000000001',
 'admin','login','user',null,'{"source":"outbox-test"}');
select public.test_assert((select count(*)=1 from public.audit_logs
 where id='eeeeeeee-0000-4000-8000-000000000001'), 'repeated acceptance and worker runs deliver exactly once');
do $$ begin
 begin
  perform public.enqueue_audit_event('eeeeeeee-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-4000-8000-000000000001',
   'admin','export_logs','logs',null,'{}');
  raise exception 'Audit event identity was overwritten';
 exception when unique_violation then null;
 end;
end $$;
create trigger test_outbox_failure before insert on public.audit_logs
 for each row execute function public.test_outbox_failure();
select public.enqueue_audit_event('eeeeeeee-0000-4000-8000-000000000002',
 '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-4000-8000-000000000001',
 'admin','export_logs','logs',null,'{}');
update public.audit_event_outbox set next_attempt_at=now()-interval '1 second' where completed_at is null;
select public.test_assert((public.process_audit_event_outbox(100,2)->>'exhausted')::integer=1,
 'exhausted events stay visible instead of silently disappearing');
drop trigger test_outbox_failure on public.audit_logs;
drop function public.test_outbox_failure();
select 'PASS audit outbox durability, exactly-once retries, privilege isolation and exhausted reporting';
