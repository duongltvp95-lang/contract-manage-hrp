"use client";

import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import {
  importPartnersAction,
  partnerImportTemplateAction,
  previewPartnersImportAction,
} from "@/app/(app)/partners/actions";
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
import { cn } from "@/lib/utils";

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

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setFileError(null);
    setRejection(null);
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

    setPreview(actionResult.data);
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
        className="w-full overflow-y-auto sm:max-w-2xl"
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
                  tác · Địa chỉ · Mã số thuế · Công ty (HRP / HR VN, cách nhau dấu
                  phẩy — bỏ trống mặc định HRP).
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
              Step 2 — preview
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
                    {preview.summary.ok} dòng hợp lệ · {preview.summary.failed} dòng lỗi
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

              <ImportRowsTable rows={preview.rows} />

              {fileError && (
                <Alert variant="destructive" data-testid="partner-import-error">
                  <AlertTitle>Không nhập được</AlertTitle>
                  <AlertDescription>{fileError}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={runImport}
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
            </div>
          )}

          {/* ---------------------------------------------------------------
              Result — shown when some rows failed, so the reasons stay visible
              ------------------------------------------------------------ */}
          {result && (
            <div className="space-y-4" data-testid="partner-import-result">
              <p className="text-sm font-medium">
                Đã nhập {result.summary.ok} · Lỗi {result.summary.failed}
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

function ImportRowsTable({ rows }: { rows: PartnerImportRowReport[] }) {
  return (
    <div className="rounded-xl shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">STT</TableHead>
            <TableHead>Tên đối tác</TableHead>
            <TableHead>Địa chỉ</TableHead>
            <TableHead>Mã số thuế</TableHead>
            <TableHead>Trạng thái</TableHead>
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
  if (row.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Hợp lệ
      </span>
    );
  }

  return (
    <span className="inline-flex items-start gap-1 text-xs text-destructive">
      <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{row.error ?? "Lỗi"}</span>
    </span>
  );
}
