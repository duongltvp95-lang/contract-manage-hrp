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
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create_user: "Tạo người dùng",
  update_user_role: "Đổi vai trò",
  set_active_user: "Đổi trạng thái hoạt động",
  delete_user: "Xoá người dùng",
  export_logs: "Xuất nhật ký",
};

export const AUDIT_TARGET_KINDS = ["user", "logs"] as const;
export type AuditTargetKind = (typeof AUDIT_TARGET_KINDS)[number];

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
