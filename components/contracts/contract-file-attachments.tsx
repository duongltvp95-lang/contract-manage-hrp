"use client";

import { RotateCcw } from "lucide-react";
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
}: {
  files: PendingFile[];
  onMergeFiles: (kind: FileKind, next: PendingFile[]) => void;
  maxUploadSizeMb: number;
  busy: boolean;
  uploadError: string | null;
  failedCount: number;
  onRetryUploads: () => void;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Tài liệu hợp đồng</CardTitle>
          <CardDescription>
            PDF, JPG hoặc PNG. Có thể tải lên nhiều tệp cho một hợp đồng.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadDropzone
            files={files.filter((f) => f.kind === "document")}
            onFilesChange={(next) => onMergeFiles("document", next)}
            maxUploadSizeMb={maxUploadSizeMb}
            kind="document"
            disabled={busy}
            inputTestId="document-dropzone-input"
          />
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
