-- Round 8, part 1 — widen the audit-log enum to cover every business action.
--
-- Round 3 logged only the admin / user-management actions. Round 8 logs the
-- business actions too (partners, contracts, files, profiles), so the two CHECK
-- constraints are widened. The columns themselves are unchanged; only the
-- allowed values grow. The re-added constraint is strictly a superset of the old
-- one, so existing rows remain valid.

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
      'update_profile'
    )
  );

alter table public.audit_logs
  drop constraint if exists audit_logs_target_kind_check;

alter table public.audit_logs
  add constraint audit_logs_target_kind_check check (
    target_kind in ('user', 'logs', 'partner', 'contract', 'file', 'profile')
  );
