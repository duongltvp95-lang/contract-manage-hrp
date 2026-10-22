-- Migration 20261029000000_audit_usage_actions.sql
-- Widen audit_logs_action_check to include user usage actions:
-- login, logout, view_file, delete_file

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
      'unarchive_contract',
      'export_partners',
      'login',
      'logout',
      'view_file',
      'delete_file'
    )
  );
