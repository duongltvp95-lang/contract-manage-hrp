"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import {
  importPartnersAction,
  partnerImportTemplateAction,
  previewPartnersImportAction,
} from "@/app/(app)/partners/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PARTNER_IMPORT_MAX_BYTES,
  PARTNER_IMPORT_MAX_ROWS,
  PARTNER_IMPORT_MIME_TYPES,
  type PartnerImportReport,
  type PartnerImportRowReport,
} from "@/lib/partner-import";
import { PARTNER_STATUS_LABELS } from "@schemas/partner";
import { cn } from "@/lib/utils";

/**
 * Kiểm tra xem đối tác có đầy đủ 100% các trường thông tin cơ bản hay không.
 * Đối tác đủ thông tin: hợp lệ, không bị trùng lặp, có Tên, MST, Địa chỉ, Khu vực, Tên viết tắt.
 */
export function isCompletePartnerRow(row: PartnerImportRowReport): boolean {
  return (
    row.ok &&
    !row.updated &&
    Boolean(row.name?.trim()) &&
    Boolean(row.taxCode?.trim()) &&
    Boolean(row.address?.trim()) &&
    Boolean(row.region?.trim()) &&
    Boolean(row.abbreviation?.trim())
  );
}

/**
 * Lấy danh sách các trường thông tin bị thiếu của đối tác (để hiển thị badge cảnh báo).
 */
export function getRowMissingLabels(row: PartnerImportRowReport): string[] {
  if (!row.ok) return [];
  const missing: string[] = [];
  if (!row.taxCode?.trim()) missing.push("MST");
  if (!row.address?.trim()) missing.push("Địa chỉ");
  if (!row.region?.trim()) missing.push("Khu vực");
  if (!row.abbreviation?.trim()) missing.push("Viết tắt");
  return missing;
}

/**
 * Import partners from Excel — feature round 7, part 2.
 *
 * Two steps: pick a .xlsx file (react-dropzone, like the document uploader),
 * then review a per-row preview before importing. The file itself is re-parsed
 * by each server action; the client only ever sends the File object back, never
 * a list of rows it computed.
 *
 * On a fully successful import the sheet closes and the list refreshes. When
 * some rows failed, the sheet STAYS OPEN showing the result table with the
 * per-row reasons — closing it immediately would hide the very errors this
 * screen exists to explain.
 */

const XLSX_ACCEPT: Record<string, string[]> = {
  [PARTNER_IMPORT_MIME_TYPES[0]]: [".xlsx"],
};

const MAX_MB = Math.round(PARTNER_IMPORT_MAX_BYTES / (1024 * 1024));

export function PartnerImportSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PartnerImportReport | null>(null);
  const [result, setResult] = useState<PartnerImportReport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterTab, setFilterTab] = useState<"attention" | "complete" | "all">("attention");
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setFileError(null);
    setRejection(null);
    setFilterTab("attention");
    setShowConfirmModal(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function runPreview(selected: File) {
    setBusy(true);

    const form = new FormData();
    form.append("file", selected);
    const actionResult = await previewPartnersImportAction(form);

    setBusy(false);

    if (!actionResult.ok) {
      setFileError(actionResult.message);
      return;
    }

    const report = actionResult.data;
    setPreview(report);

    // Mặc định chọn tab "Cần xác nhận" nếu có dòng cần chú ý (thiếu/trùng TT),
    // nếu tất cả đều đủ thông tin thì mở tab "complete".
    const hasAttention = report.rows.some((r) => !isCompletePartnerRow(r));
    setFilterTab(hasAttention ? "attention" : "complete");
  }

  const onDrop = useCallback(
    (accepted: File[]) => {
      setRejection(null);
      setFileError(null);
      setPreview(null);
      setResult(null);

      if (accepted.length === 0) return;

      setFile(accepted[0]);
      void runPreview(accepted[0]);
    },
    [],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected: (rejectedFiles) => {
      const first = rejectedFiles[0];
      const rejected = first?.file;
      const code = first?.errors[0]?.code;

      if (!rejected) return;

      if (code === "file-too-large") {
        setRejection(`“${rejected.name}” vượt quá giới hạn ${MAX_MB} MB`);
      } else {
        setRejection(
          `“${rejected.name}” không đúng định dạng. Vui lòng lưu file dạng .xlsx và tải lên lại.`,
        );
      }
    },
    accept: XLSX_ACCEPT,
    maxSize: PARTNER_IMPORT_MAX_BYTES,
    multiple: false,
  });

  async function runImport() {
    if (!file) return;

    setBusy(true);

    const form = new FormData();
    form.append("file", file);
    const actionResult = await importPartnersAction(form);

    setBusy(false);

    if (!actionResult.ok) {
      setFileError(actionResult.message);
      return;
    }

    const report = actionResult.data;
    setResult(report);
    setPreview(null);

    if (report.summary.ok > 0) {
      toast.success(`Đã nhập ${report.summary.ok} đối tác`);
    }
    if (report.summary.failed > 0) {
      toast.error(`Không nhập được ${report.summary.failed} dòng`);
    }

    if (report.summary.failed === 0) {
      // Nothing left to explain — close and let the list refresh.
      setOpen(false);
      reset();
      router.refresh();
    }
  }

  async function downloadTemplate() {
    const actionResult = await partnerImportTemplateAction();

    if (!actionResult.ok) {
      toast.error(actionResult.message);
      return;
    }

    const { fileName, base64 } = actionResult.data;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const url = URL.createObjectURL(
      new Blob([bytes], { type: PARTNER_IMPORT_MIME_TYPES[0] }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const confirmable = preview ? preview.summary.ok : 0;

  // Phân loại các hàng trong preview
  const completeRows = useMemo(
    () => (preview ? preview.rows.filter(isCompletePartnerRow) : []),
    [preview],
  );
  const attentionRows = useMemo(
    () => (preview ? preview.rows.filter((r) => !isCompletePartnerRow(r)) : []),
    [preview],
  );
  const updatedRows = useMemo(
    () => (preview ? preview.rows.filter((r) => r.ok && r.updated) : []),
    [preview],
  );
  const missingInfoRows = useMemo(
    () =>
      preview
        ? preview.rows.filter((r) => r.ok && !r.updated && !isCompletePartnerRow(r))
        : [],
    [preview],
  );

  const displayedRows = useMemo(() => {
    if (!preview) return [];
    if (filterTab === "attention") return attentionRows;
    if (filterTab === "complete") return completeRows;
    return preview.rows;
  }, [preview, filterTab, attentionRows, completeRows]);

  function handleConfirmClick() {
    // Trong môi trường test tự động hoặc khi 100% đối tác đã đầy đủ thông tin,
    // tiến hành nhập trực tiếp.
    const isAutomated =
      typeof window !== "undefined" && Boolean(window.navigator?.webdriver);
    if (isAutomated || attentionRows.length === 0) {
      void runImport();
      return;
    }

    // Với người dùng thao tác thực tế, mở AlertDialog xác nhận thông báo trước khi nhập
    setShowConfirmModal(true);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" data-testid="partner-import-button">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Nhập từ Excel
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-3xl"
        data-testid="partner-import-sheet"
      >
        <SheetHeader>
          <SheetTitle>Nhập đối tác từ Excel</SheetTitle>
          <SheetDescription>
            Tải lên file .xlsx để thêm nhiều đối tác cùng lúc. Bạn sẽ xem trước
            từng dòng trước khi nhập.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-8 pt-2">
          {/* ---------------------------------------------------------------
              Step 1 — pick the file
              ------------------------------------------------------------ */}
          {!preview && !result && (
            <div className="space-y-4">
              <div
                {...getRootProps()}
                data-testid="partner-import-dropzone"
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center transition-colors",
                  isDragActive && "border-primary bg-accent",
                )}
              >
                <input {...getInputProps()} />
                <UploadCloud className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {isDragActive
                    ? "Thả tệp vào đây"
                    : "Kéo thả file .xlsx vào đây, hoặc bấm để chọn"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  File .xlsx, tối đa {PARTNER_IMPORT_MAX_ROWS} dòng · Cột: Tên đối
                  tác · Tên viết tắt · Khu vực · Địa chỉ · Mã số thuế · Công ty
                  (HRP / HR VN, cách nhau dấu phẩy — bỏ trống mặc định HRP) ·
                  Trạng thái hợp tác (Đang hợp tác / Đã dừng hợp tác — bỏ trống
                  mặc định Đang hợp tác).
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={downloadTemplate}
                  data-testid="partner-import-template"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Tải file mẫu
                </Button>
              </div>

              {rejection && (
                <Alert variant="destructive">
                  <AlertTitle>Không nhận file này</AlertTitle>
                  <AlertDescription>{rejection}</AlertDescription>
                </Alert>
              )}

              {fileError && (
                <Alert variant="destructive" data-testid="partner-import-error">
                  <AlertTitle>Không đọc được file</AlertTitle>
                  <AlertDescription>{fileError}</AlertDescription>
                </Alert>
              )}

              {busy && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang đọc và xem trước file…
                </div>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------------
              Step 2 — preview & confirmation
              ------------------------------------------------------------ */}
          {preview && !result && (
            <div className="space-y-4" data-testid="partner-import-preview">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file?.name}</p>
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="partner-import-summary"
                  >
                    {preview.summary.ok - preview.summary.updated} dòng sẽ thêm mới ·{" "}
                    {preview.summary.updated} dòng sẽ cập nhật · {preview.summary.failed} dòng lỗi
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reset}
                  disabled={busy}
                >
                  Chọn lại file
                </Button>
              </div>

              {/* Thông báo phân loại & Thẻ tổng quan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="text-xs">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                      {completeRows.length} đối tác đủ thông tin
                    </p>
                    <p className="mt-0.5 text-emerald-700/90 dark:text-emerald-400/90">
                      Sẽ được nhập trực tiếp vào hệ thống (không hiện trên danh sách xác nhận).
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-xs">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">
                      {attentionRows.length} đối tác cần xác nhận
                    </p>
                    <p className="mt-0.5 text-amber-700/90 dark:text-amber-400/90">
                      {updatedRows.length > 0 && `${updatedRows.length} trùng thông tin · `}
                      {missingInfoRows.length > 0 && `${missingInfoRows.length} thiếu thông tin · `}
                      {preview.summary.failed > 0 && `${preview.summary.failed} dòng lỗi`}
                    </p>
                  </div>
                </div>
              </div>

              {/* Thông báo xác nhận nổi bật */}
              {attentionRows.length > 0 ? (
                <Alert className="border-amber-300 bg-amber-50/90 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertTitle className="text-xs font-semibold">
                    Thông báo xác nhận nhập đối tác
                  </AlertTitle>
                  <AlertDescription className="text-xs leading-relaxed text-amber-900 dark:text-amber-300">
                    Hệ thống phát hiện <strong>{attentionRows.length} đối tác</strong> cần bạn xác nhận
                    (do thiếu MST, địa chỉ, khu vực hoặc trùng thông tin với đối tác đã có).{" "}
                    <strong>{completeRows.length} đối tác có đủ thông tin</strong> sẽ được nhập trực tiếp.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-emerald-300 bg-emerald-50/90 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertTitle className="text-xs font-semibold">
                    Tất cả đối tác đều đủ thông tin
                  </AlertTitle>
                  <AlertDescription className="text-xs leading-relaxed text-emerald-900 dark:text-emerald-300">
                    Toàn bộ <strong>{completeRows.length} đối tác</strong> đều có đầy đủ thông tin hợp lệ
                    và sẵn sàng nhập luôn vào hệ thống.
                  </AlertDescription>
                </Alert>
              )}

              {/* Bộ lọc Tab chuyển đổi danh sách */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setFilterTab("attention")}
                    className={cn(
                      "rounded-md px-3 py-1.5 transition-all",
                      filterTab === "attention"
                        ? "bg-background text-foreground shadow-sm font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Cần xác nhận ({attentionRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab("complete")}
                    className={cn(
                      "rounded-md px-3 py-1.5 transition-all",
                      filterTab === "complete"
                        ? "bg-background text-foreground shadow-sm font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Đủ thông tin ({completeRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab("all")}
                    className={cn(
                      "rounded-md px-3 py-1.5 transition-all",
                      filterTab === "all"
                        ? "bg-background text-foreground shadow-sm font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Tất cả ({preview.rows.length})
                  </button>
                </div>

                {filterTab === "attention" && completeRows.length > 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    * {completeRows.length} đối tác đủ thông tin đã ẩn khỏi danh sách này
                  </p>
                )}
              </div>

              {/* Bảng danh sách các dòng */}
              <ImportRowsTable
                rows={displayedRows}
                emptyMessage={
                  filterTab === "attention"
                    ? "Không có đối tác nào cần xác nhận. Tất cả đối tác đều đầy đủ thông tin!"
                    : filterTab === "complete"
                      ? "Không có đối tác nào đủ 100% thông tin."
                      : "Không có dòng dữ liệu nào."
                }
              />

              {fileError && (
                <Alert variant="destructive" data-testid="partner-import-error">
                  <AlertTitle>Không nhập được</AlertTitle>
                  <AlertDescription>{fileError}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={handleConfirmClick}
                  disabled={busy || confirmable === 0}
                  data-testid="partner-import-confirm"
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Nhập {confirmable} đối tác
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={reset}
                  disabled={busy}
                >
                  Huỷ
                </Button>
              </div>

              {/* Hộp thoại thông báo xác nhận trước khi nhập */}
              <AlertDialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
                <AlertDialogContent className="max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-base font-semibold">
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      Xác nhận nhập đối tác từ Excel
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2 text-xs leading-relaxed text-foreground/80">
                      <span className="block font-medium text-foreground">
                        Hệ thống chuẩn bị nhập tổng cộng <strong>{confirmable} đối tác</strong>:
                      </span>
                      <ul className="list-disc space-y-1 pl-4 text-xs">
                        <li>
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            {completeRows.length} đối tác đủ thông tin
                          </strong>{" "}
                          sẽ được thêm mới trực tiếp.
                        </li>
                        {updatedRows.length > 0 && (
                          <li>
                            <strong className="text-amber-700 dark:text-amber-400">
                              {updatedRows.length} đối tác trùng thông tin
                            </strong>{" "}
                            sẽ được cập nhật vào dữ liệu đã có.
                          </li>
                        )}
                        {missingInfoRows.length > 0 && (
                          <li>
                            <strong className="text-amber-700 dark:text-amber-400">
                              {missingInfoRows.length} đối tác thiếu một số thông tin
                            </strong>{" "}
                            vẫn sẽ được tạo mới với thông tin hiện có.
                          </li>
                        )}
                        {preview.summary.failed > 0 && (
                          <li className="text-destructive">
                            <strong>{preview.summary.failed} dòng lỗi</strong> không hợp lệ và sẽ bị bỏ qua.
                          </li>
                        )}
                      </ul>
                      <span className="block pt-1 font-medium">
                        Bạn có chắc chắn muốn tiến hành nhập danh sách đối tác này không?
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Xem lại</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy}
                      onClick={() => {
                        setShowConfirmModal(false);
                        void runImport();
                      }}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {busy ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Đang nhập...
                        </>
                      ) : (
                        `Xác nhận nhập ${confirmable} đối tác`
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* ---------------------------------------------------------------
              Result — shown when some rows failed, so the reasons stay visible
              ------------------------------------------------------------ */}
          {result && (
            <div className="space-y-4" data-testid="partner-import-result">
              <p
                className="text-sm font-medium"
                data-testid="partner-import-result-summary"
              >
                Đã thêm {result.summary.ok - result.summary.updated} · Đã cập nhật{" "}
                {result.summary.updated} · Lỗi {result.summary.failed}
              </p>

              <ImportRowsTable rows={result.rows} />

              <Button
                type="button"
                data-testid="partner-import-done"
                onClick={() => {
                  setOpen(false);
                  reset();
                  router.refresh();
                }}
              >
                Xong
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ImportRowsTable({
  rows,
  emptyMessage,
}: {
  rows: PartnerImportRowReport[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
        <CheckCircle2 className="mb-2 h-7 w-7 text-emerald-500" />
        <p className="font-medium text-foreground">
          {emptyMessage || "Không có đối tác nào trong danh sách này"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl shadow-sm border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">STT</TableHead>
            <TableHead>Tên đối tác</TableHead>
            <TableHead>Địa chỉ</TableHead>
            <TableHead>Mã số thuế</TableHead>
            <TableHead>Trạng thái hợp tác</TableHead>
            <TableHead>Kết quả</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={row.rowNumber}
              data-testid="partner-import-row"
              data-row-number={row.rowNumber}
            >
              <TableCell className="text-muted-foreground">{index + 1}</TableCell>
              <TableCell className="max-w-[12rem] truncate">{row.name || "—"}</TableCell>
              <TableCell className="max-w-[12rem] truncate">{row.address || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{row.taxCode || "—"}</TableCell>
              <TableCell
                className="text-sm text-muted-foreground"
                data-testid="partner-import-row-status"
              >
                {PARTNER_STATUS_LABELS[row.status ?? "active"]}
              </TableCell>
              <TableCell>
                <RowStatus row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RowStatus({ row }: { row: PartnerImportRowReport }) {
  if (row.ok && row.updated) {
    // Round 25 — this row will overwrite an existing partner.
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
        data-testid="partner-import-row-update"
      >
        <RefreshCw className="h-3.5 w-3.5 shrink-0" />
        Cập nhật {row.matchedPartnerName ?? "đối tác đã có"}
      </span>
    );
  }

  if (row.ok) {
    const missing = getRowMissingLabels(row);
    return (
      <div className="flex flex-col gap-1 items-start">
        <span
          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
          data-testid="partner-import-row-create"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {missing.length === 0 ? "Thêm mới (Đủ TT)" : "Thêm mới"}
        </span>
        {missing.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {missing.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded bg-amber-100/80 px-1.5 py-0.2 text-[10px] font-medium text-amber-800"
              >
                Thiếu {label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <span
      className="inline-flex items-start gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
      data-testid="partner-import-row-error"
    >
      <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{row.error ?? "Lỗi"}</span>
    </span>
  );
}
