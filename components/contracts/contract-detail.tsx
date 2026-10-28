"use client";

import {
  AlertCircle,
  ArrowLeft,
  CalendarPlus,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { ContractActionsMenu } from "@/components/contracts/archive-contract-dialog";
import { DeleteContractButton } from "@/components/contracts/delete-contract-button";
import { EditContractSheet } from "@/components/contracts/edit-contract-sheet";
import { RenewContractDialog } from "@/components/contracts/renew-contract-dialog";
import { UnarchiveContractButton } from "@/components/contracts/unarchive-contract-button";
import type { SelectableFile } from "@/components/documents/document-selector";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { formatDateOnly, formatDateTime, formatDuration, formatExpiryHint } from "@/lib/format";
import { partnerDisplayName } from "@/lib/partner-display";
import type { PartnerRow } from "@/lib/services/partners";
import { downloadFileFromUrl, isPdfMime, requestViewUrl, type ViewUrl } from "@/lib/view-url";
import { cn } from "@/lib/utils";

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
  /** Round 33 — the company the contract is signed for; null pre-round-33. */
  company_id: string | null;
  /** Round 33+ — tên công ty (do server `getContract` resolve qua embed). */
  company_name?: string | null;
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
  canDelete = false,
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
  /** Round 19 — show the unarchive/delete actions (delete-admin emails only). */
  canDelete?: boolean;
}) {
  const router = useRouter();
  const archived = Boolean(contract.archived_at);
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isExpired = Boolean(contract.expiry_date && contract.expiry_date < todayStr);

  const pdfFiles = files.filter((file) => isPdfMime(file.mime_type));
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadPdf = async (file: SelectableFile) => {
    setDownloadingId(file.id);
    try {
      toast.info(`Đang tải tệp "${file.original_filename}"...`);
      let downloadUrl: string;
      if (initialSelectedId === file.id && initialViewUrl) {
        downloadUrl = initialViewUrl.viewUrl;
      } else {
        const signed = await requestViewUrl(file.id);
        downloadUrl = signed.viewUrl;
      }
      await downloadFileFromUrl(downloadUrl, file.original_filename);
      toast.success(`Đã tải xuống "${file.original_filename}"`);
    } catch {
      toast.error("Không thể tải tệp xuống. Vui lòng thử lại.");
    } finally {
      setDownloadingId(null);
    }
  };

  const fields: [string, string][] = [
    ["Số hợp đồng", contract.contract_number ?? "—"],
    ["Ngày ký", formatDateOnly(contract.signed_date)],
    ["Thời hạn", formatDuration(contract.duration_text, contract.signed_date, contract.expiry_date)],
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
          <Badge
            variant="secondary"
            data-testid="contract-archived-badge"
            className="rounded-full"
          >
            Đã lưu trữ
          </Badge>
        )}

        {pdfFiles.length === 1 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs font-medium border-emerald-600/30 bg-emerald-50/50 hover:bg-emerald-100/70 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/50 dark:text-emerald-400"
            onClick={() => handleDownloadPdf(pdfFiles[0])}
            disabled={Boolean(downloadingId)}
            title={`Tải file PDF: ${pdfFiles[0].original_filename}`}
          >
            {downloadingId === pdfFiles[0].id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>Tải file PDF</span>
          </Button>
        )}

        {pdfFiles.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-medium border-emerald-600/30 bg-emerald-50/50 hover:bg-emerald-100/70 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/50 dark:text-emerald-400"
                disabled={Boolean(downloadingId)}
              >
                {downloadingId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>Tải file PDF</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {pdfFiles.map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  className="gap-2 text-xs cursor-pointer"
                  onClick={() => handleDownloadPdf(f)}
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{f.original_filename}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {archived ? (
          <>
            <Button variant="outline" size="sm" disabled>
              Sửa
            </Button>
            <Button variant="ghost" size="icon" aria-label="Thao tác khác" disabled>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {canDelete && <UnarchiveContractButton contractId={contract.id} />}
          </>
        ) : (
          <>
            <RenewContractDialog
              contract={contract}
              trigger={
                <Button
                  variant={isExpired ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    isExpired && "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm",
                  )}
                  data-testid="contract-renew-button"
                >
                  <CalendarPlus className="mr-1 h-4 w-4" />
                  Gia hạn
                </Button>
              }
            />
            <EditContractSheet contract={contract} partners={partners} />
            <ContractActionsMenu
              contractId={contract.id}
              contractNumber={contract.contract_number}
            />
          </>
        )}

        {canDelete && (
          <DeleteContractButton
            contractId={contract.id}
            label="Xoá hợp đồng"
            onDeleted={() => router.push("/contracts")}
          />
        )}
      </header>

      {!archived && isExpired && (
        <div className="border-b px-4 py-3 bg-red-500/[0.04] border-red-500/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                Hợp đồng này <strong>đã hết hạn</strong> từ ngày {formatDateOnly(contract.expiry_date)} ({formatExpiryHint(contract.expiry_date)}).
              </span>
            </div>
            <RenewContractDialog
              contract={contract}
              trigger={
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all hover:shadow"
                >
                  <CalendarPlus className="mr-1.5 h-4 w-4" />
                  Gia hạn ngay
                </Button>
              }
            />
          </div>
        </div>
      )}

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
            contractId={contract.id}
            files={files}
            initialViewUrl={initialViewUrl}
            initialSelectedId={initialSelectedId}
            canDelete={canDelete && !archived}
            readOnly={archived}
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
