-- Round 19, part 2 — add the unarchive action to the audit-log enum.

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check check (
    action in (
      'create_user',
      'update_user_role',
      'set_active_user',
      'delete_user',
      'export_logs',
      'create_partner',
      'update_partner',
      'import_partners',
      'create_contract',
      'update_contract',
      'archive_contract',
      'upload_file',
      'update_profile',
      'set_partner_status',
      'delete_contract',
      'delete_partner',
      'unarchive_contract'
    )
  );
