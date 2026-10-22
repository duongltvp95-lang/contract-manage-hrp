"use client";

import { Loader2, Upload, FileUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { completeUploadAction, deleteContractFileAction } from "@/app/(app)/contracts/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes } from "@/lib/format";
import {
  inferFileKindFromFilename,
  putFileWithProgress,
  requestContractUploadUrl,
  resolveUploadMimeType,
} from "@/lib/upload";
import type { FileKind } from "@schemas/file";

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export function UploadContractFileDialog({
  contractId,
  open,
  onOpenChange,
  replacingFileId,
  replacingFileName,
  defaultKind = "document",
  onSuccess,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replacingFileId?: string;
  replacingFileName?: string;
  defaultKind?: FileKind;
  onSuccess?: (newFileId: string) => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [kind, setKind] = useState<FileKind>(defaultKind);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadAttempt, setUploadAttempt] = useState<{
    fileId: string;
    objectKey: string;
    uploadReservation: string;
  } | null>(null);

  const resetState = () => {
    setSelectedFile(null);
    setProgress(0);
    setError(null);
    setIsUploading(false);
    setUploadAttempt(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError(`Tệp vượt quá giới hạn 50 MB (kích thước tệp: ${formatBytes(file.size)}).`);
      setSelectedFile(null);
      return;
    }

    if (!resolveUploadMimeType(file)) {
      setError("Chỉ chấp nhận tệp định dạng PDF, PNG hoặc JPG.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setUploadAttempt(null);
    const inferred = inferFileKindFromFilename(file.name);
    setKind(inferred);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Vui lòng chọn tệp để tải lên.");
      return;
    }

    setIsUploading(true);
    setProgress(5);
    setError(null);

    try {
      const mimeType = resolveUploadMimeType(selectedFile);
      if (!mimeType) {
        throw new Error("Chỉ chấp nhận tệp định dạng PDF, PNG hoặc JPG.");
      }

      // Nếu lượt trước đã được cấp reservation, thử hoàn tất trước để tránh PUT lại.
      if (uploadAttempt) {
        const priorComplete = await completeUploadAction({
          contractId,
          ...uploadAttempt,
          filename: selectedFile.name,
          mimeType,
          fileSize: selectedFile.size,
          kind,
        });
        if (priorComplete.ok) {
          toast.success(`Đã tải lên tệp "${selectedFile.name}" thành công`);
          resetState();
          onOpenChange(false);
          onSuccess?.(uploadAttempt.fileId);
          router.refresh();
          return;
        }
      }

      // 1. Xin URL presigned PUT từ server, tái sử dụng reservation khi retry.
      const { fileId, objectKey, uploadUrl, uploadReservation } = await requestContractUploadUrl({
        contractId,
        filename: selectedFile.name,
        mimeType,
        fileSize: selectedFile.size,
        kind,
        fileId: uploadAttempt?.fileId,
        uploadReservation: uploadAttempt?.uploadReservation,
      });
      const attempt = { fileId, objectKey, uploadReservation };
      setUploadAttempt(attempt);

      // 2. Upload tệp trực tiếp lên Cloudflare R2
      await putFileWithProgress(uploadUrl, selectedFile, {
        contentType: mimeType,
        onProgress: (p) => setProgress(p.percent),
      });

      // 3. Xác thực HEAD và lưu bản ghi vào database
      const completeRes = await completeUploadAction({
        contractId,
        ...attempt,
        filename: selectedFile.name,
        mimeType,
        fileSize: selectedFile.size,
        kind,
      });

      if (!completeRes.ok) {
        throw new Error(completeRes.message);
      }

      // 4. Nếu là thao tác thay thế tệp cũ bị mất/hỏng, xóa bản ghi cũ
      if (replacingFileId) {
        await deleteContractFileAction(replacingFileId).catch(() => {});
      }

      toast.success(
        replacingFileId
          ? `Đã thay thế tệp "${selectedFile.name}" thành công`
          : `Đã tải lên tệp "${selectedFile.name}" thành công`,
      );

      resetState();
      onOpenChange(false);
      onSuccess?.(fileId);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Tải tệp lên thất bại. Vui lòng thử lại.";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isUploading) return;
        if (!next) resetState();
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-md max-h-[calc(100svh-2rem)] overflow-y-auto"
        data-testid="upload-contract-file-dialog"
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>
            {replacingFileId ? "Tải lên tệp thay thế" : "Thêm tài liệu vào hợp đồng"}
          </DialogTitle>
          <DialogDescription>
            {replacingFileId
              ? `Tải lên tệp mới để thay thế tệp "${replacingFileName ?? "hiện tại"}" bị thiếu hoặc hỏng.`
              : "Đính kèm thêm tệp văn bản hợp đồng hoặc phụ lục vào hợp đồng này."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Loại tệp */}
          <div className="space-y-2">
            <Label htmlFor="file-kind-select" className="text-sm font-medium">
              Phân loại tệp
            </Label>
            <Select
              value={kind}
              onValueChange={(val: string) => {
                setKind(val as FileKind);
                setUploadAttempt(null);
              }}
              disabled={isUploading}
            >
              <SelectTrigger id="file-kind-select" className="w-full">
                <SelectValue placeholder="Chọn phân loại tệp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="document">Tài liệu chính</SelectItem>
                <SelectItem value="appendix">Phụ lục hợp đồng</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Vùng chọn tệp */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Chọn tệp (PDF, JPG, PNG)</Label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              disabled={isUploading}
              className="hidden"
              id="contract-file-upload-input"
            />

            {selectedFile ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileUp className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(selectedFile.size)}
                    </p>
                  </div>
                </div>
                {!isUploading && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary/60 hover:bg-muted/30"
              >
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Bấm để chọn tệp hoặc kéo thả vào đây</p>
                <p className="text-xs text-muted-foreground">
                  Hỗ trợ PDF, PNG, JPG tối đa 50 MB
                </p>
              </div>
            )}
          </div>

          {/* Thanh tiến trình */}
          {isUploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Đang tải lên Cloudflare R2...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Lỗi */}
          {error && (
            <p className="rounded bg-destructive/10 p-2 text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUploading}
          >
            Huỷ
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
          >
            {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isUploading ? "Đang xử lý..." : replacingFileId ? "Thay thế tệp" : "Tải lên"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
