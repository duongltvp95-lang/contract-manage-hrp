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

import { formatAuditMetadata } from "@/lib/audit-display";
import { getCurrentUser } from "@/lib/auth";
import {
  listAuditLogs,
  recordAudit,
  type AuditLogRow,
} from "@/lib/services/audit-logs";

/**
 * Admin log export — round 3, part 1.
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
  // The export ignores page/pageSize — see LogsExportButton.
  const filter = { ...parsed.data, page: 1, pageSize: 200 } as const;

  const format = (raw.format ?? "txt").toLowerCase();
  if (format !== "txt" && format !== "xlsx") {
    return NextResponse.json(
      { error: "Định dạng không hỗ trợ. Hãy chọn txt hoặc xlsx.", code: "validation" },
      { status: 422 },
    );
  }

  // Read up to `pageSize` rows. The cap is the same as the page (200). The
  // admin has the filter UI for narrowing; the export is "everything I can
  // see at the default page size", not a full backfill.
  const list = await listAuditLogs(user.organizationId, filter);
  if (!list.ok) {
    return NextResponse.json(
      { error: list.message, code: list.code },
      { status: statusForCode(list.code) },
    );
  }

  // Log the export itself. Failures here are non-fatal (the file is already
  // ready), so the result is dropped without rethrowing.
  void recordAudit({
    organizationId: user.organizationId,
    actorId: user.id,
    actorRole: "admin",
    action: "export_logs",
    targetKind: "logs",
    targetId: null,
    metadata: { format, count: list.data.rows.length },
  });

  const today = new Date().toISOString().slice(0, 10);
  if (format === "txt") {
    const body = formatTxt(list.data.rows);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="audit-logs-${today}.txt"`,
        "cache-control": "no-store",
      },
    });
  }

  const body = await formatXlsx(list.data.rows);
  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="audit-logs-${today}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

function formatTxt(rows: AuditLogRow[]): string {
  const header = ["Thời gian", "Người thực hiện", "Vai trò", "Hành động", "Đối tượng", "Chi tiết"].join(" | ");
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.actorId,
      row.actorRole,
      actionLabel(row.action),
      targetLabel(row.targetKind, row.targetId),
      formatAuditMetadata(row.metadata),
    ].join(" | "),
  );
  return [header, ...lines].join("\n") + "\n";
}

async function formatXlsx(rows: AuditLogRow[]): Promise<Buffer> {
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
  for (const row of rows) {
    sheet.addRow({
      createdAt: row.createdAt,
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: actionLabel(row.action),
      target: targetLabel(row.targetKind, row.targetId),
      metadata: formatAuditMetadata(row.metadata),
    });
  }
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
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
