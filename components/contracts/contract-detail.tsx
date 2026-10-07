"use client";

import { ArrowLeft, MoreHorizontal } from "lucide-react";
import Link from "next/link";

import { ContractActionsMenu } from "@/components/contracts/archive-contract-dialog";
import { EditContractSheet } from "@/components/contracts/edit-contract-sheet";
import type { SelectableFile } from "@/components/documents/document-selector";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { partnerDisplayName } from "@/lib/partner-display";
import type { PartnerRow } from "@/lib/services/partners";
import type { ViewUrl } from "@/lib/view-url";

/**
 * Contract detail — plan sections 54, 65, 66.
 *
 * 65% document viewer / 35% metadata on desktop; on narrow screens the two
 * stack. The header carries the Edit Sheet (W1-WEB-031) and the Archive menu
 * (W1-WEB-032).
 *
 * An archived contract stays reachable by direct link — archiving hides it from
 * the list and the dashboard (the owner's decision for M7) rather than deleting
 * it — but Edit and Archive are disabled, because changing a record the user
 * cannot see, or archiving it twice, would both be confusing.
 */

export type ContractDetailData = {
  id: string;
  contract_number: string | null;
  signed_date: string | null;
  duration_text: string | null;
  expiry_date: string | null;
  partner_text: string | null;
  partner_id: string | null;
  /** Resolved through the partner link; null for a contract with free text only. */
  partner_name?: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export function ContractDetail({
  contract,
  partners = [],
  files,
  filesError,
  initialViewUrl,
  initialSelectedId,
}: {
  contract: ContractDetailData;
  /** The partner directory, for the Edit Sheet's combobox. */
  partners?: Pick<PartnerRow, "id" | "name">[];
  files: SelectableFile[];
  filesError?: string | null;
  /** Signed on the server when the page opened (plan section 59). */
  initialViewUrl?: ViewUrl | null;
  /** `?file=<id>` deep link. */
  initialSelectedId?: string | null;
}) {
  const archived = Boolean(contract.archived_at);

  const fields: [string, string][] = [
    ["Số hợp đồng", contract.contract_number ?? "—"],
    ["Ngày ký", formatDateOnly(contract.signed_date)],
    ["Thời hạn", contract.duration_text ?? "—"],
    ["Ngày hết hạn", formatDateOnly(contract.expiry_date)],
    // The linked partner's name wins; the free-text column is what an older
    // contract still shows (feature round 2).
    ["Đối tác", partnerDisplayName(contract)],
  ];

  // Round 16: the notes row only exists for old contracts that actually have one
  // — a new contract shows no empty row and no em-dash.
  if (contract.notes?.trim()) {
    fields.push(["Ghi chú", contract.notes]);
  }

  return (
    <div className="flex min-h-[calc(100svh-4rem)] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/contracts">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Hợp đồng
          </Link>
        </Button>

        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {contract.contract_number ?? "Hợp đồng"}
        </h1>

        {archived && (
          <Badge variant="secondary" data-testid="contract-archived-badge">
            Đã lưu trữ
          </Badge>
        )}

        {archived ? (
          <>
            <Button variant="outline" size="sm" disabled>
              Sửa
            </Button>
            <Button variant="ghost" size="icon" aria-label="Thao tác khác" disabled>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <EditContractSheet contract={contract} partners={partners} />
            <ContractActionsMenu
              contractId={contract.id}
              contractNumber={contract.contract_number}
            />
          </>
        )}
      </header>

      {archived && (
        <div className="border-b px-4 py-3">
          <Alert data-testid="contract-archived-notice">
            <AlertTitle>Hợp đồng đã được lưu trữ</AlertTitle>
            <AlertDescription>
              Hợp đồng này đã bị ẩn khỏi danh sách và trang tổng quan. Dữ liệu và
              tệp đính kèm vẫn được giữ nguyên.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        {/* 65% — document viewer (plan section 54) */}
        <section aria-label="Tài liệu" className="min-h-[28rem] min-w-0 space-y-3">
          {filesError && (
            <Alert variant="destructive">
              <AlertTitle>Không đọc được danh sách tài liệu</AlertTitle>
              <AlertDescription>{filesError}</AlertDescription>
            </Alert>
          )}
          <DocumentViewer
            files={files}
            initialViewUrl={initialViewUrl}
            initialSelectedId={initialSelectedId}
          />
        </section>

        {/* 35% — metadata (plan section 54) */}
        <aside aria-label="Thông tin hợp đồng" className="min-w-0 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Thông tin hợp đồng
          </h2>

          <dl className="space-y-3">
            {fields.map(([label, value], index) => (
              <div key={label}>
                {index > 0 && <Separator className="mb-3" />}
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-line text-sm font-medium break-words">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <Separator />
          <p className="text-xs text-muted-foreground">
            Cập nhật lần cuối: {formatDateTime(contract.updated_at)}
          </p>
        </aside>
      </div>
    </div>
  );
}
