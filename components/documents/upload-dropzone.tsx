"use client";

import { FileText, ImageIcon, Loader2, Trash2, UploadCloud, XCircle, CheckCircle2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ALLOWED_MIME_TYPES } from "@schemas/file";
import { formatBytes } from "@/lib/format";
import { newPendingFile, type PendingFile } from "@/lib/upload";
import { cn } from "@/lib/utils";

/**
 * Drag & drop uploader — plan sections 15, 41, 43, 45.
 *
 * react-dropzone owns the interaction (plan section 15: no custom drag/drop
 * engine). This component only renders the queue and its progress; the actual
 * create → presign → PUT → persist orchestration lives in ContractForm.
 */

const ACCEPT: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

export function UploadDropzone({
  files,
  onFilesChange,
  maxUploadSizeMb,
  disabled = false,
}: {
  files: PendingFile[];
  onFilesChange: (files: PendingFile[]) => void;
  maxUploadSizeMb: number;
  disabled?: boolean;
}) {
  const maxBytes = maxUploadSizeMb * 1024 * 1024;

  const [rejections, setRejections] = useState<string[]>([]);

  const onDrop = useCallback(
    (accepted: File[], rejected: unknown[]) => {
      setRejections(describeRejections(rejected, maxUploadSizeMb));
      if (accepted.length === 0) return;
      onFilesChange([...files, ...accepted.map(newPendingFile)]);
    },
    [files, onFilesChange, maxUploadSizeMb, setRejections],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: maxBytes,
    multiple: true,
    disabled,
  });

  const removeFile = (id: string) =>
    onFilesChange(files.filter((f) => f.id !== id));

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors",
          isDragActive && !isDragReject && "border-primary bg-accent",
          isDragReject && "border-destructive bg-destructive/10",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {isDragActive ? "Thả tệp vào đây" : "Kéo thả tệp vào đây, hoặc bấm để chọn"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, JPG, PNG — tối đa {maxUploadSizeMb} MB mỗi tệp. Có thể chọn nhiều tệp.
        </p>
      </div>

      {rejections.length > 0 && (
        <ul className="space-y-1 text-sm text-destructive">
          {rejections.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((pending) => (
            <li
              key={pending.id}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <FileIcon mimeType={pending.file.type} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {pending.file.name}
                  </span>
                  <StatusBadge status={pending.status} />
                </div>

                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatBytes(pending.file.size)}</span>
                  {pending.status === "uploading" && <span>{pending.progress}%</span>}
                </div>

                {pending.status === "uploading" && (
                  <Progress value={pending.progress} className="mt-2 h-1.5" />
                )}

                {pending.error && (
                  <p className="mt-1 text-xs text-destructive">{pending.error}</p>
                )}
              </div>

              {!disabled && pending.status !== "uploading" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Xoá ${pending.file.name}`}
                  onClick={() => removeFile(pending.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith("image/") ? ImageIcon : FileText;
  return <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />;
}

function StatusBadge({ status }: { status: PendingFile["status"] }) {
  if (status === "uploading") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Đang tải
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Đã tải lên
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3 w-3" /> Lỗi
      </span>
    );
  }
  return null;
}

/**
 * Turns react-dropzone rejections into Vietnamese messages.
 *
 * Presentation-only: the authoritative type/size check is
 * `PresignUploadSchema` on the server (plan sections 38, 39).
 */
function describeRejections(rejected: unknown[], maxUploadSizeMb: number): string[] {
  return rejected
    .map((item) => {
      const entry = item as { file?: File; errors?: { code: string; message: string }[] };
      const name = entry.file?.name ?? "tệp";
      const code = entry.errors?.[0]?.code;
      if (code === "file-too-large") {
        return `"${name}" vượt quá ${maxUploadSizeMb} MB`;
      }
      if (code === "file-invalid-type") {
        return `"${name}" không đúng định dạng cho phép (${ALLOWED_MIME_TYPES.join(", ")})`;
      }
      return `"${name}" không hợp lệ`;
    })
    .filter(Boolean);
}
