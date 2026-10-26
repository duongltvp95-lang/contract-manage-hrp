"use client";

import { useState, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format, addMonths, parseISO } from "date-fns";
import { CalendarPlus, Loader2, Upload, FileText, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { renewContractAction } from "@/app/(app)/contracts/actions";
import { DateField } from "@/components/contracts/date-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatDateOnly, formatExpiryHint, formatBytes } from "@/lib/format";
import {
  putFileWithProgress,
  requestContractUploadUrl,
  resolveUploadMimeType,
} from "@/lib/upload";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export type ContractForRenewal = {
  id: string;
  contract_number: string | null;
  signed_date: string | null;
  expiry_date: string | null;
  duration_text: string | null;
  notes?: string | null;
};

export function RenewContractDialog({
  contract,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  onRenewed,
}: {
  contract: ContractForRenewal;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRenewed?: () => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = setControlledOpen ?? setInternalOpen;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isExpired = Boolean(contract.expiry_date && contract.expiry_date < todayStr);

  // Mốc cơ sở để tính gia hạn nhanh:
  // Nếu đã hết hạn: tính từ ngày hôm nay
  // Nếu còn hạn: tính từ ngày hết hạn hiện tại
  const baseDate = contract.expiry_date && contract.expiry_date >= todayStr
    ? parseISO(contract.expiry_date)
    : new Date();

  const [newExpiryDate, setNewExpiryDate] = useState<string | undefined>(undefined);
  const [newDurationText, setNewDurationText] = useState("");
  const [renewalNotes, setRenewalNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setNewExpiryDate(undefined);
    setNewDurationText("");
    setRenewalNotes("");
    setSelectedFile(null);
    setActivePreset(null);
    setError(null);
    setUploadProgress(0);
    setIsSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleApplyPreset = (monthsToAdd: number, label: string) => {
    setActivePreset(label);
    const targetDate = addMonths(baseDate, monthsToAdd);
    const formatted = format(targetDate, "yyyy-MM-dd");
    setNewExpiryDate(formatted);
    setNewDurationText(label === "1 năm" || label === "2 năm" ? `Gia hạn ${label}` : `Gia hạn ${monthsToAdd} tháng`);
    setError(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`Tệp vượt quá giới hạn 50 MB (kích thước tệp: ${formatBytes(file.size)}).`);
      setSelectedFile(null);
      return;
    }

    if (!resolveUploadMimeType(file)) {
      setError("Chỉ chấp nhận tệp phụ lục định dạng PDF, PNG hoặc JPG.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpiryDate) {
      setError("Vui lòng chọn ngày hết hạn mới cho hợp đồng.");
      return;
    }

    if (contract.signed_date && newExpiryDate < contract.signed_date) {
      setError(`Ngày hết hạn mới (${formatDateOnly(newExpiryDate)}) không thể trước ngày ký hợp đồng (${formatDateOnly(contract.signed_date)}).`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setUploadProgress(10);

    try {
      let appendixPayload: {
        fileId: string;
        objectKey: string;
        uploadReservation: string;
        filename: string;
        mimeType: string;
        fileSize: number;
        baseContractNumber?: string;
      } | undefined = undefined;

      // 1. Tải lên tệp phụ lục nếu có
      if (selectedFile) {
        const mimeType = resolveUploadMimeType(selectedFile);
        if (!mimeType) throw new Error("Định dạng tệp không được hỗ trợ");

        setUploadProgress(20);
        const { fileId, objectKey, uploadUrl, uploadReservation } = await requestContractUploadUrl({
          contractId: contract.id,
          filename: selectedFile.name,
          mimeType,
          fileSize: selectedFile.size,
          kind: "appendix",
          baseContractNumber: contract.contract_number ?? undefined,
        });

        await putFileWithProgress(uploadUrl, selectedFile, {
          contentType: mimeType,
          onProgress: (p) => setUploadProgress(20 + Math.round(p.percent * 0.6)),
        });

        appendixPayload = {
          fileId,
          objectKey,
          uploadReservation,
          filename: selectedFile.name,
          mimeType,
          fileSize: selectedFile.size,
          baseContractNumber: contract.contract_number ?? undefined,
        };
      }

      setUploadProgress(85);

      // 2. Gọi Server Action gia hạn hợp đồng
      const res = await renewContractAction({
        contractId: contract.id,
        newExpiryDate,
        newDurationText: newDurationText.trim() || undefined,
        notes: renewalNotes.trim() || undefined,
        appendixFile: appendixPayload,
      });

      if (!res.ok) {
        throw new Error(res.message);
      }

      setUploadProgress(100);
      toast.success(
        `Đã gia hạn hợp đồng ${contract.contract_number ?? ""} đến ngày ${formatDateOnly(newExpiryDate)} thành công!`,
      );
      resetForm();
      setOpen(false);
      onRenewed?.();
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gia hạn hợp đồng thất bại. Vui lòng thử lại.";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        if (!next) resetForm();
        setOpen(next);
      }}
    >
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button
            variant={isExpired ? "default" : "outline"}
            size="sm"
            className={cn(isExpired && "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm")}
          >
            <CalendarPlus className="mr-1.5 h-4 w-4" />
            Gia hạn
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
              <CalendarPlus className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">Gia hạn hợp đồng</DialogTitle>
              <DialogDescription className="text-xs">
                Cập nhật ngày hết hạn và thời hạn hiệu lực mới cho hồ sơ hợp đồng.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Thông tin tóm tắt hợp đồng */}
        <div className="rounded-xl border bg-muted/30 p-3.5 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Số hợp đồng:</span>
            <span className="font-mono font-semibold text-foreground">
              {contract.contract_number ?? "(chưa có số)"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Ngày ký:</span>
            <span>{formatDateOnly(contract.signed_date)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Hạn hiện tại:</span>
            <div className="flex items-center gap-2">
              <span className={cn("font-medium", isExpired ? "text-red-600 dark:text-red-400" : "")}>
                {formatDateOnly(contract.expiry_date)}
              </span>
              {isExpired && (
                <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] px-1.5 py-0 font-normal">
                  {formatExpiryHint(contract.expiry_date)}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Chọn ngày hết hạn mới */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-expiry-date" className="text-sm font-medium">
                Ngày hết hạn mới <span className="text-red-500">*</span>
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {isExpired ? "Tính gia hạn từ hôm nay" : "Tính gia hạn từ hạn cũ"}
              </span>
            </div>

            {/* Nút chọn nhanh */}
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant={activePreset === "+ 6 tháng" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs rounded-lg"
                onClick={() => handleApplyPreset(6, "+ 6 tháng")}
              >
                + 6 tháng
              </Button>
              <Button
                type="button"
                variant={activePreset === "+ 1 năm" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs rounded-lg"
                onClick={() => handleApplyPreset(12, "+ 1 năm")}
              >
                + 1 năm
              </Button>
              <Button
                type="button"
                variant={activePreset === "+ 2 năm" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs rounded-lg"
                onClick={() => handleApplyPreset(24, "+ 2 năm")}
              >
                + 2 năm
              </Button>
            </div>

            <DateField
              id="new-expiry-date"
              value={newExpiryDate}
              onChange={(val) => {
                setNewExpiryDate(val);
                setActivePreset(null);
                setError(null);
              }}
              placeholder="Chọn ngày hết hạn mới"
            />
          </div>

          {/* Thời hạn mới */}
          <div className="space-y-1.5">
            <Label htmlFor="new-duration" className="text-sm font-medium">
              Thời hạn hiển thị (tuỳ chọn)
            </Label>
            <Input
              id="new-duration"
              value={newDurationText}
              onChange={(e) => setNewDurationText(e.target.value)}
              placeholder="Ví dụ: Gia hạn 1 năm, 6 tháng..."
              className="text-sm"
            />
          </div>

          {/* Tệp phụ lục gia hạn đính kèm */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center justify-between">
              <span>Phụ lục gia hạn đính kèm (tuỳ chọn)</span>
              <span className="text-xs text-muted-foreground font-normal">PDF, PNG, JPG ≤ 50MB</span>
            </Label>

            {selectedFile ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{selectedFile.name}</p>
                    <p className="text-[11px] text-muted-foreground">{formatBytes(selectedFile.size)}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-center cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <Upload className="h-5 w-5 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">
                  Bấm để chọn tệp phụ lục gia hạn
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Tệp sẽ tự động được lưu vào danh mục Phụ lục của hợp đồng
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Ghi chú lý do gia hạn */}
          <div className="space-y-1.5">
            <Label htmlFor="renewal-notes" className="text-sm font-medium">
              Ghi chú gia hạn (tuỳ chọn)
            </Label>
            <Textarea
              id="renewal-notes"
              value={renewalNotes}
              onChange={(e) => setRenewalNotes(e.target.value)}
              placeholder="Ví dụ: Gia hạn thêm 1 năm theo Phụ lục số 01 ký kết ngày..."
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          {isSubmitting && uploadProgress > 0 && (
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Đang xử lý gia hạn...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-1.5" />
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
              disabled={isSubmitting}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !newExpiryDate}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang xử lý...
                </>
              ) : (
                <>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  Xác nhận gia hạn
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
