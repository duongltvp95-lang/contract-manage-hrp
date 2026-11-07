// NOTE: `runtime = "nodejs"` and `dynamic = "force-dynamic"` are NOT declared here.
// Next 16's `cacheComponents: true` does not support per-segment route config
// exports. The dynamic import of exceljs (CJS, Node Buffer) works fine in the
// default Node runtime that Next 16 assigns to API route handlers automatically.
// If this route is ever added to a Turbopack build pipeline, the import must
// remain dynamic to avoid pulling exceljs into the client bundle.

import { type NextRequest, NextResponse } from "next/server";

import {
  AUDIT_ACTION_LABELS,
  AUDIT_TARGET_KIND_LABELS,
  LogsFilterSchema,
  type AuditAction,
  type AuditTargetKind,
} from "@schemas/audit-log";

import { formatAuditSentence } from "@/lib/audit-display";
import { getCurrentUser } from "@/lib/auth";
import { businessDate } from "@/lib/business-date";
import {
  exportAuditLogs,
  recordAudit,
  type AuditLogRow,
  type AuditLogsExportResult,
} from "@/lib/services/audit-logs";

/**
 * Admin log export — round 3, part 1 (hardened in A12).
 *
 * Two formats, both served from the same endpoint:
 *
 *   - `format=txt`   — one line per row, UTF-8, no BOM;
 *   - `format=xlsx`  — a real Excel file via `exceljs`, loaded only here so
 *                     it never enters the client bundle.
 *
 * Authorization: `getCurrentUser()` is the only gate, and the same checks the
 * page applies (admin + same-organization). The service re-applies them, so
 * a stale token cannot pass. The action itself is logged: an export that
 * happens off the page is still a privileged action.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập", code: "unauthenticated" },
      { status: 401 },
    );
  }
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Chỉ quản trị viên mới có quyền xuất nhật ký", code: "forbidden" },
      { status: 403 },
    );
  }

  const raw: Record<string, string> = {};
  const params = request.nextUrl.searchParams;
  for (const [key, value] of params.entries()) {
    raw[key] = value;
  }
  const parsed = LogsFilterSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Bộ lọc không hợp lệ",
        code: "validation",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  const format = (raw.format ?? "txt").toLowerCase();
  if (format !== "txt" && format !== "xlsx") {
    return NextResponse.json(
      { error: "Định dạng không hỗ trợ. Hãy chọn txt hoặc xlsx.", code: "validation" },
      { status: 422 },
    );
  }

  // Paginated export up to AUDIT_LOGS_EXPORT_MAX_ROWS (5,000 rows), with explicit
  // count/truncation headers and in-file truncation notice when total exceeds the cap.
  const exported = await exportAuditLogs(user.organizationId, parsed.data);
  if (!exported.ok) {
    return NextResponse.json(
      { error: exported.message, code: exported.code },
      { status: statusForCode(exported.code) },
    );
  }

  const { rows, total, truncated, maxRows } = exported.data;
  const body =
    format === "txt"
      ? formatTxt(exported.data)
      : Buffer.from(await formatXlsx(exported.data));

  // Do not release the export unless its audit event has been durably accepted.
  const audit = await recordAudit({
    organizationId: user.organizationId,
    actorId: user.id,
    actorRole: "admin",
    action: "export_logs",
    targetKind: "logs",
    targetId: null,
    metadata: { format, count: rows.length, total, truncated },
  });
  if (!audit.ok) {
    return NextResponse.json(
      { error: "Không thể ghi nhận lượt xuất nhật ký. Vui lòng thử lại.", code: "db_error" },
      { status: 503 },
    );
  }

  const exportMetaHeaders = {
    "cache-control": "no-store",
    "x-audit-export-count": String(rows.length),
    "x-audit-export-total": String(total),
    "x-audit-export-max-rows": String(maxRows),
    "x-audit-export-truncated": truncated ? "true" : "false",
  };

  const today = businessDate();
  if (format === "txt") {
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="audit-logs-${today}.txt"`,
        ...exportMetaHeaders,
      },
    });
  }

  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="audit-logs-${today}.xlsx"`,
      ...exportMetaHeaders,
    },
  });
}

function formatTruncationNotice(
  meta: Pick<AuditLogsExportResult, "rows" | "total" | "maxRows">,
): string {
  return `[LƯU Ý GIỚI HẠN XUẤT] Tệp này chứa ${meta.rows.length}/${meta.total} sự kiện mới nhất (tối đa ${meta.maxRows} dòng mỗi lượt xuất). Hãy thu hẹp khoảng thời gian (Từ ngày / Đến ngày) để xuất phần còn lại.`;
}

function formatTxt(exported: AuditLogsExportResult): string {
  const header = ["Thời gian", "Người thực hiện", "Vai trò", "Hành động", "Đối tượng", "Chi tiết"].join(" | ");
  const lines = exported.rows.map((row) =>
    [
      row.createdAt,
      actorDisplay(row),
      row.actorRole,
      actionLabel(row.action),
      targetLabel(row.targetKind, row.targetId),
      formatAuditSentence(row),
    ].join(" | "),
  );
  if (exported.truncated) {
    lines.push(`# ${formatTruncationNotice(exported)}`);
  }
  return [header, ...lines].join("\n") + "\n";
}

async function formatXlsx(exported: AuditLogsExportResult): Promise<Buffer> {
  // Dynamic import keeps exceljs (≈ 925 KB minified) out of the client bundle
  // and out of any route that does not need it.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Contract Manager";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Nhật ký", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Thời gian", key: "createdAt", width: 24 },
    { header: "Người thực hiện", key: "actorId", width: 40 },
    { header: "Vai trò", key: "actorRole", width: 10 },
    { header: "Hành động", key: "action", width: 26 },
    { header: "Đối tượng", key: "target", width: 42 },
    { header: "Chi tiết", key: "metadata", width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of exported.rows) {
    sheet.addRow({
      createdAt: row.createdAt,
      actorId: actorDisplay(row),
      actorRole: row.actorRole,
      action: actionLabel(row.action),
      target: targetLabel(row.targetKind, row.targetId),
      metadata: formatAuditSentence(row),
    });
  }
  if (exported.truncated) {
    const noticeRow = sheet.addRow({
      createdAt: "",
      actorId: "",
      actorRole: "",
      action: "LƯU Ý GIỚI HẠN XUẤT",
      target: `${exported.rows.length}/${exported.total} dòng`,
      metadata: formatTruncationNotice(exported),
    });
    noticeRow.font = { italic: true };
  }
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

function actorDisplay(row: AuditLogRow): string {
  if (row.actorName && row.actorEmail) {
    return `${row.actorName} (${row.actorEmail})`;
  }
  return row.actorName ?? row.actorEmail ?? "[Người dùng đã xoá]";
}

function actionLabel(action: AuditAction): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

function targetLabel(kind: AuditTargetKind, id: string | null): string {
  const label = AUDIT_TARGET_KIND_LABELS[kind] ?? kind;
  if (!id) return label;
  return `${label} · ${id}`;
}

function statusForCode(code: string): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "validation":
      return 422;
    default:
      return 500;
  }
}
