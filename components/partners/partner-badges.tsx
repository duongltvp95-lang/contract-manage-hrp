import { PARTNER_STATUS_LABELS, type PartnerStatus } from "@schemas/partner";

import { Badge } from "@/components/ui/badge";

/**
 * Status + company badges shared by the partners table and the detail page
 * (round 10).
 */

export function PartnerStatusBadge({ status }: { status: PartnerStatus }) {
  const active = status === "active";

  return (
    <Badge
      variant="outline"
      data-testid={`partner-status-${status}`}
      className={
        active
          ? "rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
          : "rounded-full border-transparent bg-muted text-muted-foreground"
      }
    >
      {PARTNER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CompanyBadges({ companies }: { companies: string[] }) {
  if (companies.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  // Round 35 — gộp tất cả công ty thành 1 badge "HRP / HR VN" thay vì N badge
  // riêng. Lý do: sau khi gộp DB các bản ghi trùng MST (mỗi bản ghi cũ gắn 1
  // công ty), 1 partner có thể liên kết 2 công ty; hiện 1 badge tiết kiệm
  // không gian và đọc rõ "đối tác này dùng chung cho cả 2 công ty".
  //
  // Filter ở cùng file vẫn nhận `companies: string[]` đầy đủ, không phá logic
  // lọc "Công ty" (round 30) — filter so khớp từng tên trong mảng, không phụ
  // thuộc cấu trúc hiển thị.
  //
  // Thứ tự trong mảng phụ thuộc truy vấn DB (thường là insertion order), và
  // sau gộp có thể không cố định. Sắp xếp theo alphabet ở đây để badge ổn
  // định "HR VN / HRP" giữa các lần chạy test.
  const joined = [...companies].sort().join(" / ");
  return (
    <Badge
      variant="secondary"
      data-testid="partner-company-badge"
      className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
    >
      {joined}
    </Badge>
  );
}
