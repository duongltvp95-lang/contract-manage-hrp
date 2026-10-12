"use client";

import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { FileKind } from "@schemas/file";
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
import type { PendingFile } from "@/lib/upload";

/**
 * File attachments section for contract creation (primary document + appendix dropzones, plus retry alert).
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
  isExtractingAi = false,
}: {
  files: PendingFile[];
  onMergeFiles: (kind: FileKind, next: PendingFile[]) => void;
  maxUploadSizeMb: number;
  busy: boolean;
  uploadError: string | null;
  failedCount: number;
  onRetryUploads: () => void;
  onExtractAi?: (file: PendingFile) => void;
  isExtractingAi?: boolean;
}) {
  const documentFiles = files.filter((f) => f.kind === "document");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Tài liệu hợp đồng</CardTitle>
          <CardDescription>
            PDF, JPG hoặc PNG. Có thể tải lên nhiều tệp cho một hợp đồng.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UploadDropzone
            files={documentFiles}
            onFilesChange={(next) => onMergeFiles("document", next)}
            maxUploadSizeMb={maxUploadSizeMb}
            kind="document"
            disabled={busy || isExtractingAi}
            inputTestId="document-dropzone-input"
          />

          {documentFiles.length > 0 && onExtractAi && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-purple-200 bg-purple-50/60 p-3.5 dark:border-purple-900/50 dark:bg-purple-950/20">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 shrink-0">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                </div>
                <div className="text-sm">
                  <p className="font-medium text-purple-950 dark:text-purple-200">
                    Trích xuất thông tin tự động bằng Gemini AI
                  </p>
                  <p className="text-xs text-purple-700/80 dark:text-purple-400/80">
                    Tự động đọc số HĐ, ngày ký, thời hạn và khớp đối tác từ tệp đính kèm.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={busy || isExtractingAi}
                onClick={() => onExtractAi(documentFiles[0])}
                className="bg-purple-600 hover:bg-purple-700 text-white shrink-0 shadow-sm"
                data-testid="ai-extract-button"
              >
                {isExtractingAi ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    AI đang phân tích...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Điền tự động bằng AI
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phụ lục hợp đồng</CardTitle>
          <CardDescription>
            Chỉ chấp nhận file PDF. Có thể tải lên nhiều phụ lục.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadDropzone
            files={files.filter((f) => f.kind === "appendix")}
            onFilesChange={(next) => onMergeFiles("appendix", next)}
            maxUploadSizeMb={maxUploadSizeMb}
            accept={{ "application/pdf": [".pdf"] }}
            kind="appendix"
            hint={`Chỉ chấp nhận file PDF — tối đa ${maxUploadSizeMb} MB mỗi tệp. Có thể chọn nhiều tệp.`}
            disabled={busy}
            inputTestId="appendix-dropzone-input"
          />
        </CardContent>
      </Card>

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
