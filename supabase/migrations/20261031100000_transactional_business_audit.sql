-- One event per entity/action/transaction; junction changes merge into the row event.
alter table public.audit_logs add column transaction_id bigint;
create unique index audit_logs_transaction_entity_action_idx
  on public.audit_logs(transaction_id,target_kind,target_id,action)
  where transaction_id is not null;

create function public.append_transaction_audit(
 p_org uuid,p_actor uuid,p_action text,p_kind text,p_target uuid,p_metadata jsonb
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_role text; v_action text := p_action;
begin
 select role into v_role from public.profiles
  where id=p_actor and organization_id=p_org and is_active and not is_tombstone;
 if not found then raise exception 'Audit actor is unavailable' using errcode='42501'; end if;
 if p_kind='partner' and p_action in ('update_partner','set_partner_status') then
   select action into v_action from public.audit_logs
    where transaction_id=txid_current() and target_kind=p_kind and target_id=p_target
      and action in ('create_partner','update_partner') limit 1;
   v_action := coalesce(v_action,p_action);
 end if;
 insert into public.audit_logs as log
  (organization_id,actor_id,actor_role,action,target_kind,target_id,metadata,transaction_id)
 values(p_org,p_actor,v_role,v_action,p_kind,p_target,p_metadata,txid_current())
 on conflict (transaction_id,target_kind,target_id,action) where transaction_id is not null
 do update set metadata=(log.metadata || excluded.metadata) || jsonb_build_object(
   'changed', (select coalesce(jsonb_agg(distinct value),'[]'::jsonb)
     from jsonb_array_elements(coalesce(log.metadata->'changed','[]'::jsonb)
       || coalesce(excluded.metadata->'changed','[]'::jsonb)))
 );
end;
$$;

create function public.audit_business_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
 v_row jsonb;
 v_actor uuid := auth.uid();
 v_action text;
 v_kind text;
 v_target uuid;
 v_org uuid;
 v_meta jsonb := '{}'::jsonb;
 v_changed jsonb := '[]'::jsonb;
 v_name text;
begin
 if auth.role() is distinct from 'authenticated' or v_actor is null then
   return null;
 end if;
 v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='partner_companies' then
   v_target := (v_row->>'partner_id')::uuid;
   select organization_id,name into v_org,v_name from public.partners where id=v_target;
   if not found then return null; end if;
   v_kind := 'partner'; v_action := 'update_partner';
   v_changed := '["companies"]';
   v_meta := jsonb_build_object('name',v_name);
 else
   v_target := (v_row->>'id')::uuid; v_org := (v_row->>'organization_id')::uuid;
   if tg_op='UPDATE' then
     select coalesce(jsonb_agg(case key
       when 'contract_number' then 'contractNumber' when 'signed_date' then 'signedDate'
       when 'expiry_date' then 'expiryDate' when 'duration_text' then 'durationText'
       when 'partner_id' then 'partnerId' when 'company_id' then 'companyId'
       when 'partner_text' then 'partnerText' when 'tax_code' then 'taxCode'
       when 'full_name' then 'fullName' when 'accent_color' then 'accentColor'
       when 'background_color' then 'backgroundColor' when 'sidebar_color' then 'sidebarColor'
       else key end order by key),'[]'::jsonb) into v_changed
       from jsonb_each(v_row) item
       where key not in ('updated_at','created_at') and value is distinct from to_jsonb(old)->key;
   end if;
   if tg_table_name='contracts' then
     v_kind := 'contract';
     v_action := case when tg_op='INSERT' then 'create_contract'
       when old.archived_at is null and new.archived_at is not null then 'archive_contract'
       else 'update_contract' end;
     v_meta := jsonb_build_object('contractNumber',v_row->>'contract_number');
     v_meta := v_meta || jsonb_build_object(
       'partnerName',(select name from public.partners where id=(v_row->>'partner_id')::uuid and organization_id=v_org),
       'companyName',(select name from public.companies where id=(v_row->>'company_id')::uuid and organization_id=v_org));
     if tg_op='UPDATE' and old.expiry_date is distinct from new.expiry_date then
       v_meta := v_meta || jsonb_build_object('previousExpiryDate',old.expiry_date,'newExpiryDate',new.expiry_date);
       if old.expiry_date is not null and new.expiry_date > old.expiry_date then
         v_meta := v_meta || jsonb_build_object('action_subtype','renew_contract');
       end if;
     end if;
   elsif tg_table_name='partners' then
     v_kind := 'partner';
     v_action := case when tg_op='INSERT' then 'create_partner'
       when v_changed='["status"]'::jsonb then 'set_partner_status' else 'update_partner' end;
     v_meta := jsonb_build_object('name',v_row->>'name','status',v_row->>'status');
     v_meta := v_meta || jsonb_build_object('taxCode',v_row->>'tax_code','address',v_row->>'address');
     if tg_op='UPDATE' and old.status is distinct from new.status then
       v_meta := v_meta || jsonb_build_object('from',old.status,'to',new.status);
     end if;
   elsif tg_table_name='profiles' then
     v_kind := 'profile'; v_action := 'update_profile';
   end if;
 end if;
 if v_kind='partner' then
   v_meta := v_meta || jsonb_build_object('companies',(
     select coalesce(jsonb_agg(c.name order by c.name),'[]'::jsonb)
     from public.partner_companies pc join public.companies c on c.id=pc.company_id and c.organization_id=v_org
     where pc.partner_id=v_target));
 end if;
 perform public.append_transaction_audit(v_org,v_actor,v_action,v_kind,v_target,
   v_meta || jsonb_build_object('changed',v_changed,'source','database'));
 return null;
end;
$$;
revoke all on function public.append_transaction_audit(uuid,uuid,text,text,uuid,jsonb),
 public.audit_business_write() from public, anon, authenticated, service_role;
create trigger contracts_audit_write after insert or update on public.contracts
 for each row execute function public.audit_business_write();
create trigger partners_audit_write after insert or update on public.partners
 for each row execute function public.audit_business_write();
create trigger partner_companies_audit_write after insert or delete on public.partner_companies
 for each row execute function public.audit_business_write();
create trigger profiles_audit_write after update on public.profiles
 for each row execute function public.audit_business_write();
-- Upload audit belongs to the verified completion RPC, not arbitrary service-role fixture INSERTs.


create or replace function public.complete_contract_file_upload(
  p_file_id uuid,
  p_organization_id uuid,
  p_contract_id uuid,
  p_object_key text,
  p_bucket text,
  p_original_filename text,
  p_mime_type text,
  p_file_size bigint,
  p_checksum text,
  p_created_by uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_file public.contract_files%rowtype;
  v_contract_id uuid;
  v_prefix text;
  v_remainder text;
begin
  if p_file_id is null or p_organization_id is null or p_contract_id is null
     or p_object_key is null or p_bucket is null or p_original_filename is null or p_mime_type is null
     or p_file_size is null or p_file_size < 0 or p_created_by is null
     or p_kind is null or p_kind not in ('document', 'appendix') then
    raise exception 'Invalid contract file upload arguments' using errcode = '22023';
  end if;

  if auth.role() is distinct from 'service_role' then
    raise exception 'Caller role cannot persist contract files' using errcode = '42501';
  end if;

  select c.id into v_contract_id
  from public.contracts as c
  where c.id = p_contract_id
    and c.organization_id = p_organization_id
    and c.archived_at is null
  for share;
  if not found then
    raise exception 'Contract is unavailable for file upload' using errcode = '55000';
  end if;

  v_prefix := 'contracts/' || lower(p_organization_id::text) || '/'
    || lower(p_contract_id::text) || '/' || lower(p_file_id::text) || '/';
  if left(p_object_key, char_length(v_prefix)) <> v_prefix then
    raise exception 'Object key does not match contract file ids' using errcode = '22023';
  end if;
  v_remainder := substring(p_object_key from char_length(v_prefix) + 1);
  if v_remainder = '' or pg_catalog.strpos(v_remainder, '/') > 0
     or pg_catalog.strpos(v_remainder, pg_catalog.chr(92)) > 0 or v_remainder = '..' then
    raise exception 'Invalid contract file object key' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('r2-object:' || p_object_key, 0)
  );

  select cf.* into v_file
  from public.contract_files as cf
  where cf.id = p_file_id;

  if found then
    if v_file.organization_id = p_organization_id
       and v_file.contract_id = p_contract_id
       and v_file.object_key = p_object_key then
      return pg_catalog.to_jsonb(v_file);
    end if;
    raise exception 'Contract file id is already in use' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.r2_cleanup_queue as q
    where q.object_key = p_object_key
  ) then
    raise exception 'Object key is permanently reserved for cleanup' using errcode = '55000';
  end if;

  insert into public.contract_files (
    id, organization_id, contract_id, storage_provider, bucket, object_key,
    original_filename, mime_type, file_size, checksum, created_by, kind
  ) values (
    p_file_id, p_organization_id, p_contract_id, 'r2', p_bucket, p_object_key,
    p_original_filename, p_mime_type, p_file_size, p_checksum, p_created_by, p_kind
  )
  returning * into v_file;

  perform public.append_transaction_audit(
    p_organization_id, p_created_by, 'upload_file', 'file', p_file_id,
    pg_catalog.jsonb_build_object('filename',p_original_filename,'contractId',p_contract_id,
      'kind',p_kind,'size',p_file_size,'source','database')
  );
  return pg_catalog.to_jsonb(v_file);
end;
$function$;
