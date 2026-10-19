"use client";

import { AlertCircle, Loader2, RotateCcw, Sparkles, Upload } from "lucide-react";
import type { FileKind } from "@schemas/file";
import type { MatchedBaseContract } from "@schemas/contract";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { newPendingFile, type PendingFile } from "@/lib/upload";

/**
 * File attachments section for contract creation (unified smart dropzone + appendix detection & matching).
 */
export function ContractFileAttachments({
  files,
  onMergeFiles,
  maxUploadSizeMb,
  busy,
  uploadError,
  failedCount,
  onRetryUploads,
  onExtractAi,
  onExtractAllAi,
  isExtractingAi = false,
  onToggleFileKind,
  appendixNotice,
  onAttachToExistingContract,
  isAttachingToExisting = false,
  onDismissAppendixNotice,
}: {
  files: PendingFile[];
  onMergeFiles: (kind: FileKind, next: PendingFile[]) => void;
  maxUploadSizeMb: number;
  busy: boolean;
  uploadError: string | null;
  failedCount: number;
  onRetryUploads: () => void;
  onExtractAi?: (file: PendingFile) => void;
  onExtractAllAi?: (files: PendingFile[]) => void;
  isExtractingAi?: boolean;
  onToggleFileKind?: (fileId: string) => void;
  appendixNotice?: {
    type: "found" | "not_found";
    baseContractNumber: string;
    baseContract?: MatchedBaseContract | null;
    file: PendingFile;
  } | null;
  onAttachToExistingContract?: (baseContractId: string, file: PendingFile) => void;
  isAttachingToExisting?: boolean;
  onDismissAppendixNotice?: () => void;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Tài liệu & Phụ lục đính kèm</CardTitle>
          <CardDescription>
            PDF, JPG hoặc PNG. Bạn có thể kéo thả cả Hợp đồng chính và Phụ lục vào đây. AI sẽ tự động đọc, phân loại và nhận diện.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UploadDropzone
            files={files}
            onFilesChange={(next) => onMergeFiles("document", next)}
            maxUploadSizeMb={maxUploadSizeMb}
            kind="document"
            disabled={busy || isExtractingAi || isAttachingToExisting}
            inputTestId="document-dropzone-input"
            showKindBadge={true}
            onToggleKind={onToggleFileKind}
            onExtractAi={onExtractAi}
            isExtractingAi={isExtractingAi}
            hint={`PDF, JPG, PNG — tối đa ${maxUploadSizeMb} MB mỗi tệp. Có thể kéo thả nhiều tệp cùng lúc.`}
          />

          {files.length > 0 && onExtractAi && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-purple-200 bg-purple-50/60 p-3.5 dark:border-purple-900/50 dark:bg-purple-950/20">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 shrink-0">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                </div>
                <div className="text-sm">
                  <p className="font-medium text-purple-950 dark:text-purple-200">
                    Trích xuất & Phân loại tự động bằng Gemini AI
                  </p>
                  <p className="text-xs text-purple-700/80 dark:text-purple-400/80">
                    Tự động nhận diện Hợp đồng chính / Phụ lục, đối soát với các hợp đồng đã có và điền thông tin.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={busy || isExtractingAi || isAttachingToExisting}
                onClick={() => {
                  if (onExtractAllAi && files.length > 1) {
                    onExtractAllAi(files);
                  } else if (onExtractAi && files.length > 0) {
                    onExtractAi(files[0]);
                  }
                }}
                className="bg-purple-600 hover:bg-purple-700 text-white shrink-0 shadow-sm"
                data-testid="ai-extract-button"
              >
                {isExtractingAi ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    AI đang phân tích & phân loại...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    {files.length > 1
                      ? `Phân tích tất cả (${files.length} tệp) bằng AI`
                      : "Điền tự động bằng AI"}
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thông báo AI nhận diện Phụ lục & Đối soát với Hợp đồng có sẵn */}
      {appendixNotice && appendixNotice.type === "found" && (
        <Alert className="border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-950/20">
          <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertTitle className="text-blue-950 dark:text-blue-200 font-semibold">
            ✨ Phát hiện Phụ lục của Hợp đồng đã có trên hệ thống
          </AlertTitle>
          <AlertDescription className="text-blue-900/90 dark:text-blue-300 space-y-2 mt-1">
            <p>
              Tệp <strong>&ldquo;{appendixNotice.file.file.name}&rdquo;</strong> được AI nhận diện là phụ lục của Hợp đồng số{" "}
              <strong className="text-blue-700 dark:text-blue-300">&ldquo;{appendixNotice.baseContractNumber}&rdquo;</strong>
              {appendixNotice.baseContract?.partnerName ? ` (Đối tác: ${appendixNotice.baseContract.partnerName})` : ""}.
              Hợp đồng này đã có sẵn trên hệ thống!
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {onAttachToExistingContract && appendixNotice.baseContract && (
                <Button
                  type="button"
                  size="sm"
                  disabled={isAttachingToExisting || busy}
                  onClick={() => onAttachToExistingContract(appendixNotice.baseContract!.id, appendixNotice.file)}
                  className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                  data-testid="attach-to-existing-contract-btn"
                >
                  {isAttachingToExisting ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Đang gán vào Hợp đồng...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      Gán ngay vào Hợp đồng {appendixNotice.baseContractNumber}
                    </>
                  )}
                </Button>
              )}
              {onDismissAppendixNotice && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isAttachingToExisting || busy}
                  onClick={onDismissAppendixNotice}
                >
                  Giữ lại để tạo Hợp đồng mới
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {appendixNotice && appendixNotice.type === "not_found" && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Chưa tìm thấy hợp đồng gốc để gán phụ lục</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>
              Tệp <strong>&ldquo;{appendixNotice.file.file.name}&rdquo;</strong> là phụ lục của hợp đồng{" "}
              <strong>&ldquo;{appendixNotice.baseContractNumber}&rdquo;</strong>, nhưng hiện tại <strong>chưa có hợp đồng này được tải lên hệ thống để gán</strong>.
            </p>
            <p className="text-xs opacity-90">
              Bạn vui lòng tải lên hợp đồng gốc <strong>&ldquo;{appendixNotice.baseContractNumber}&rdquo;</strong> trước hoặc tiếp tục nhập thông tin để tạo hợp đồng mới.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Input hỗ trợ tương thích kiểm thử tự động e2e appendix-dropzone-input */}
      <div className="sr-only">
        <input
          type="file"
          data-testid="appendix-dropzone-input"
          onChange={(e) => {
            if (e.target.files) {
              const added = Array.from(e.target.files).map((f) => newPendingFile(f, "appendix"));
              onMergeFiles("appendix", added);
            }
          }}
        />
      </div>

      {uploadError && (
        <Alert variant="destructive">
          <AlertTitle>
            Hợp đồng đã được lưu, nhưng tải tệp lên thất bại
          </AlertTitle>
          <AlertDescription>
            <p className="mb-2 whitespace-pre-line">{uploadError}</p>
            <p className="mb-3">
              Hợp đồng vẫn được giữ lại và thông tin bạn đã nhập không bị mất.
              Bấm &quot;Thử lại&quot; để tải lại {failedCount} tệp lỗi.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetryUploads}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
