-- Round 19, part 1 — add the hard-delete actions to the audit-log enum.
--
-- Only the CHECK constraint widens (a strict superset); the columns and the
-- target_kind enum are unchanged.

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
      'delete_partner'
    )
  );
