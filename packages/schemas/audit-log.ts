import { z } from "zod";

/**
 * Audit-log schemas — feature round 3, part 1 + round 4, part 1.
 *
 * The enum of actions is the single source of truth: the database CHECK
 * constraint, the service, and the UI all import from here. Adding an action
 * means editing the migration's CHECK too, and forgetting it shows up as a
 * database error the first time the new action runs — loud and immediate.
 *
 * Round 4 re-introduces `delete_user` after the round 3 explicit "no delete"
 * decision was reversed by the owner. The CHECK constraint on
 * `audit_logs.action` was already updated in round 3 to include the value,
 * so no DB migration is needed for the enum itself.
 */

export const AUDIT_ACTIONS = [
  "create_user",
  "update_user_role",
  "set_active_user",
  "delete_user",
  "export_logs",
  "create_partner",
  "update_partner",
  "import_partners",
  "create_contract",
  "update_contract",
  "archive_contract",
  "upload_file",
  "update_profile",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create_user: "Tạo người dùng",
  update_user_role: "Đổi vai trò",
  set_active_user: "Đổi trạng thái hoạt động",
  delete_user: "Xoá người dùng",
  export_logs: "Xuất nhật ký",
  create_partner: "Thêm đối tác",
  update_partner: "Sửa đối tác",
  import_partners: "Nhập đối tác từ Excel",
  create_contract: "Thêm hợp đồng",
  update_contract: "Sửa hợp đồng",
  archive_contract: "Lưu trữ hợp đồng",
  upload_file: "Tải tệp lên",
  update_profile: "Cập nhật hồ sơ",
};

export const AUDIT_TARGET_KINDS = [
  "user",
  "logs",
  "partner",
  "contract",
  "file",
  "profile",
] as const;
export type AuditTargetKind = (typeof AUDIT_TARGET_KINDS)[number];

/**
 * Vietnamese labels for the target kinds (round 8). The round 3 UI labelled only
 * a couple of kinds inline; centralising the map here lets the part 2 table show
 * every kind without a second switch statement.
 */
export const AUDIT_TARGET_KIND_LABELS: Record<AuditTargetKind, string> = {
  user: "Người dùng",
  logs: "Nhật ký",
  partner: "Đối tác",
  contract: "Hợp đồng",
  file: "Tệp",
  profile: "Hồ sơ",
};

/**
 * Query string for `/admin/logs` and the export endpoint.
 *
 * The page and the export read the same shape, so the filter UI and the
 * "Xuất .txt / .xlsx" buttons stay in lock-step without a second parser.
 *
 * `z.iso.datetime()` is the Zod v4 helper for an ISO-8601 timestamp (`2026-10-06T09:00:00Z`).
 * It accepts a `Z` suffix or a numeric offset; the form sends the former.
 */
export const LogsFilterSchema = z.object({
  actorId: z.uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type LogsFilter = z.infer<typeof LogsFilterSchema>;
