/**
 * Audit-log display rules — feature round 8, part 2; round 9, part 1.
 *
 * Pure and framework-free: the table (client) and the export route (server)
 * both use the same rules, so "how is this metadata shown?" has exactly one
 * answer. The goal is a compact, human-readable line — never a raw JSON blob.
 */

import {
  AUDIT_ACTION_LABELS,
  type AuditAction,
} from "@schemas/audit-log";

import { formatBytes } from "@/lib/format";

/**
 * Turns an audit row's `metadata` into a short Vietnamese summary.
 *
 * The business actions (round 8) each write a small, well-known shape; those
 * keys are rendered with friendly labels and Vietnamese phrasing. Any key this
 * formatter does not know about is still shown as `key: value` (so nothing is
 * silently hidden), but the value is a single scalar, not a nested dump.
 */
export function formatAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Object.keys(metadata).length === 0
  ) {
    return "—";
  }

  const parts: string[] = [];

  // Known scalar fields, in a friendly order.
  for (const [key, label] of [
    ["name", "Tên"],
    ["contractNumber", "Số hợp đồng"],
    ["partnerName", "Đối tác"],
    ["filename", "Tệp"],
    ["taxCode", "MST"],
  ] as const) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim() !== "") {
      parts.push(`${label}: ${value}`);
    }
  }

  if (typeof metadata.size === "number") {
    parts.push(`Kích thước: ${formatBytes(metadata.size)}`);
  }

  if (typeof metadata.created === "number" || typeof metadata.failed === "number") {
    parts.push(`Đã nhập ${metadata.created ?? 0} · Lỗi ${metadata.failed ?? 0}`);
  }

  const changed = metadata.changed;
  if (Array.isArray(changed) && changed.length > 0) {
    parts.push(`Đã sửa: ${changed.map(String).join(", ")}`);
  }

  if (typeof metadata.format === "string") {
    parts.push(`Định dạng: ${metadata.format}`);
  }
  if (typeof metadata.count === "number") {
    parts.push(`Số dòng: ${metadata.count}`);
  }

  // Everything else, as a compact "key: value" list. This keeps older
  // (round 3) user-management shapes readable without a nested JSON dump.
  const handled = new Set([
    "name",
    "contractNumber",
    "partnerName",
    "filename",
    "taxCode",
    "size",
    "created",
    "failed",
    "changed",
    "format",
    "count",
  ]);

  for (const [key, value] of Object.entries(metadata)) {
    if (handled.has(key)) continue;
    parts.push(`${key}: ${compactValue(value)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Round 9, part 1 — natural Vietnamese sentences
// ---------------------------------------------------------------------------

/** The subset of an audit row the sentence formatter needs. */
export type AuditSentenceRow = {
  actorName: string | null;
  action: AuditAction;
  metadata: Record<string, unknown>;
};

/**
 * Turns one audit row into a natural Vietnamese sentence of the form
 * "<actor> đã <động từ> <tân ngữ>".
 *
 * A missing metadata field simply drops that clause — the sentence never breaks
 * and never falls back to a raw JSON dump. A missing actor name becomes
 * "Một người dùng" (chosen over "Người dùng đã xoá đã …" to avoid the doubled
 * "đã … đã").
 */
export function formatAuditSentence(row: AuditSentenceRow): string {
  const actor = row.actorName?.trim() || "Một người dùng";
  const meta = row.metadata ?? {};
  return `${actor} đã ${sentenceFor(row.action, meta)}`;
}

function sentenceFor(action: AuditAction, meta: Record<string, unknown>): string {
  switch (action) {
    case "create_partner":
      return quoted("thêm đối tác", text(meta.name));
    case "update_partner":
      return quoted("sửa đối tác", text(meta.name));
    case "import_partners":
      return importPartners(meta);
    case "create_contract":
      return createContract(meta);
    case "update_contract":
      return quoted("sửa hợp đồng", text(meta.contractNumber));
    case "archive_contract":
      return quoted("lưu trữ hợp đồng", text(meta.contractNumber));
    case "unarchive_contract":
      return quoted("bỏ lưu trữ hợp đồng", text(meta.contractNumber));
    case "delete_contract":
      return quoted("xoá hợp đồng", text(meta.contractNumber));
    case "delete_partner":
      return quoted("xoá đối tác", text(meta.name));
    case "upload_file":
      return uploadFile(meta);
    case "update_profile":
      return "cập nhật hồ sơ";
    case "set_partner_status":
      return setPartnerStatus(meta);
    case "create_user":
      return quoted("thêm người dùng", text(meta.fullName) || text(meta.name));
    case "update_user_role":
      return updateUserRole(meta);
    case "set_active_user":
      return setActiveUser(meta);
    case "delete_user":
      return quoted("xoá người dùng", text(meta.fullName) || text(meta.name));
    case "export_logs":
      return "xuất nhật ký";
    default:
      return `thực hiện “${AUDIT_ACTION_LABELS[action] ?? action}”`;
  }
}

/** `thêm đối tác` / `thêm đối tác “X”` — the quote is dropped when there is no value. */
function quoted(verb: string, value: string): string {
  return value ? `${verb} “${value}”` : verb;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function importPartners(meta: Record<string, unknown>): string {
  const created = typeof meta.created === "number" ? meta.created : null;
  const failed = typeof meta.failed === "number" ? meta.failed : null;

  if (created === null || failed === null) {
    return "nhập đối tác từ Excel";
  }

  return `nhập đối tác từ Excel: ${created} thành công, ${failed} lỗi`;
}

function createContract(meta: Record<string, unknown>): string {
  const number = text(meta.contractNumber);
  const partner = text(meta.partnerName);

  const base = number ? `thêm hợp đồng “${number}”` : "thêm hợp đồng";
  return partner ? `${base} với đối tác “${partner}”` : base;
}

function uploadFile(meta: Record<string, unknown>): string {
  const filename = text(meta.filename);
  const base = filename ? `tải tệp lên “${filename}”` : "tải tệp lên";

  if (typeof meta.size !== "number") return base;
  return `${base} (${formatSize(meta.size)})`;
}

function updateUserRole(meta: Record<string, unknown>): string {
  const to = text(meta.to);
  return to ? `đổi vai trò thành “${to}”` : "đổi vai trò";
}

function setActiveUser(meta: Record<string, unknown>): string {
  if (meta.to === true) return "bật người dùng";
  if (meta.to === false) return "vô hiệu hoá người dùng";
  return "đổi trạng thái người dùng";
}

/** Round 10 — "dừng hợp tác với đối tác X" / "khôi phục hợp tác với đối tác X". */
function setPartnerStatus(meta: Record<string, unknown>): string {
  const name = text(meta.name);
  const partner = name ? ` với đối tác “${name}”` : "";

  if (meta.to === "stopped") return `dừng hợp tác${partner}`;
  if (meta.to === "active") return `khôi phục hợp tác${partner}`;
  return `đổi trạng thái hợp tác${partner}`;
}

/**
 * Vietnamese byte size with a comma decimal separator (matching the round 9
 * spec: "878 B" / "1,2 KB"). Kept separate from `formatBytes`, which the upload
 * UI uses with a dot and whole-unit rounding.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes;
  for (const unit of units) {
    value /= 1024;
    if (value < 1024 || unit === "GB") {
      const fixed = value.toFixed(1).replace(".", ",").replace(/,0$/, "");
      return `${fixed} ${unit}`;
    }
  }

  return `${bytes} B`;
}
