/**
 * Audit-log display rules — feature round 8, part 2.
 *
 * Pure and framework-free: the table (client) and the export route (server)
 * both use the same rules, so "how is this metadata shown?" has exactly one
 * answer. The goal is a compact, human-readable line — never a raw JSON blob.
 */

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
