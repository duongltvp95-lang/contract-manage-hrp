import { type NextRequest, NextResponse } from "next/server";

import { PARTNER_STATUS_LABELS } from "@schemas/partner";

import { getCurrentUser } from "@/lib/auth";
import { listPartners, type PartnerWithCount } from "@/lib/services/partners";

/**
 * Partner export — round 23.
 *
 * One worksheet "Đối tác" with the whole directory (or one status scope via
 * `?status=active|stopped`). The same dynamic-exceljs pattern as the admin log
 * export keeps the library out of every bundle that does not build a workbook.
 *
 * Authorization: any signed-in user of the organization (no admin role), and
 * `listPartners` re-applies the organization scoping — the export is always
 * the caller's own directory.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const rawStatus = request.nextUrl.searchParams.get("status");
  const status =
    rawStatus === "active" || rawStatus === "stopped" ? rawStatus : undefined;

  const list = await listPartners({ organizationId: user.organizationId, status });
  if (!list.ok) {
    return NextResponse.json(
      { error: list.message, code: list.code },
      { status: statusForCode(list.code) },
    );
  }

  const body = await formatXlsx(list.data);

  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix =
    status === "active"
      ? "dang-hop-tac"
      : status === "stopped"
        ? "da-dung-hop-tac"
        : null;
  const filename = suffix
    ? `doi-tac-${suffix}-${today}.xlsx`
    : `doi-tac-${today}.xlsx`;

  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

async function formatXlsx(rows: PartnerWithCount[]): Promise<Buffer> {
  // Dynamic import keeps exceljs out of the client bundle (same note as the
  // admin log export route).
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Contract Manager";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Đối tác", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Tên đối tác", key: "name", width: 36 },
    { header: "Tên viết tắt", key: "abbreviation", width: 16 },
    { header: "Mã số thuế", key: "taxCode", width: 16 },
    { header: "Địa chỉ", key: "address", width: 44 },
    { header: "Khu vực", key: "region", width: 20 },
    { header: "Công ty", key: "companies", width: 20 },
    { header: "Trạng thái hợp tác", key: "status", width: 20 },
    { header: "Số hợp đồng", key: "contractCount", width: 14 },
    { header: "Ngày tạo", key: "createdAt", width: 24 },
    { header: "Cập nhật lúc", key: "updatedAt", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      name: row.name,
      abbreviation: row.abbreviation ?? "",
      taxCode: row.tax_code ?? "",
      address: row.address ?? "",
      region: row.region ?? "",
      companies: row.companies.join(", "),
      status: PARTNER_STATUS_LABELS[row.status] ?? row.status,
      contractCount: row.contract_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
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
