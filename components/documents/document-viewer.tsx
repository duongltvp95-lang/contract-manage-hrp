"use client";

import { FileQuestion, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { deleteContractFileAction } from "@/app/(app)/contracts/actions";
import { DocumentSelector, type SelectableFile } from "@/components/documents/document-selector";
import { ImageViewer } from "@/components/documents/image-viewer";
import { PdfPanel } from "@/components/documents/pdf-panel";
import { UploadContractFileDialog } from "@/components/documents/upload-contract-file-dialog";
import { ViewerErrorBoundary } from "@/components/documents/viewer-error-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  downloadFileFromUrl,
  formatPdfErrorMessage,
  isImageMime,
  isPdfMime,
  msUntilRefresh,
  requestViewUrl,
  type ViewUrl,
} from "@/lib/view-url";

/**
 * Document viewer — plan sections 55, 59, 60.
 *
 * Owns "which file" and "which signed URL", and hands the URL to the matching
 * viewer. The URL is fetched from `/api/files/view-url`, never built here: R2 is
 * private, and the server is the only thing allowed to authorize (plan section
 * 73).
 *
 * Signed-URL refresh works two ways (plan section 60):
 *   - proactively, a minute before the signature expires;
 *   - reactively, when a viewer reports a load failure.
 * Both just bump an attempt counter, so there is one code path.
 *
 * Page and zoom live inside the viewers and are keyed by URL, so a refresh does
 * not reset them.
 */

/** How many automatic retries a file gets before we stop and show the error. */
const MAX_AUTO_RETRIES = 2;

export function DocumentViewer({
  contractId,
  files,
  initialViewUrl = null,
  initialSelectedId = null,
  canDelete = false,
  readOnly = false,
}: {
  contractId?: string;
  files: SelectableFile[];
  /** Signed server-side when the detail page opens — plan section 59. */
  initialViewUrl?: ViewUrl | null;
  /** `?file=<id>` deep link, validated by the page. */
  initialSelectedId?: string | null;
  canDelete?: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const firstId = initialSelectedId ?? files[0]?.id ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [replacingFile, setReplacingFile] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteFile = async (file: SelectableFile) => {
    if (!contractId || readOnly || !canDelete) return;
    const confirmed = window.confirm(
      `Bạn có chắc chắn muốn xoá tệp "${file.original_filename}" khỏi hợp đồng này không?`,
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const res = await deleteContractFileAction(file.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Đã xoá tệp "${file.original_filename}"`);
      router.refresh();
    } catch {
      toast.error("Không thể xoá tệp. Vui lòng thử lại.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadFile = async (file: SelectableFile) => {
    try {
      let downloadUrl: string;
      if (loaded && loaded.fileId === file.id && current) {
        downloadUrl = current.viewUrl;
      } else {
        const signed = await requestViewUrl(file.id);
        downloadUrl = signed.viewUrl;
      }
      toast.info(`Đang tải tệp "${file.original_filename}"...`);
      await downloadFileFromUrl(downloadUrl, file.original_filename);
    } catch {
      toast.error("Không thể tải tệp xuống. Vui lòng thử lại.");
    }
  };

  /**
   * The URL, together with which file and which attempt it was minted for.
   * Bundling them means "is this URL still current?" is a comparison rather than
   * a chain of effects, and switching files needs no state reset.
   */
  const [loaded, setLoaded] = useState<{
    fileId: string;
    attempt: number;
    url: ViewUrl;
  } | null>(
    initialViewUrl && firstId
      ? { fileId: firstId, attempt: 0, url: initialViewUrl }
      : null,
  );

  const retries = useRef(0);

  const current =
    loaded && loaded.fileId === selectedId && loaded.attempt === attempt
      ? loaded.url
      : null;
  const selected = files.find((file) => file.id === selectedId) ?? null;
  const loading = selectedId !== null && current === null && error === null;

  useEffect(() => {
    if (!selectedId) return;
    // Already have a URL for this file at this attempt (e.g. the server-side one).
    if (loaded?.fileId === selectedId && loaded.attempt === attempt) return;

    const controller = new AbortController();

    requestViewUrl(selectedId, controller.signal)
      .then((url) => {
        setLoaded({ fileId: selectedId, attempt, url });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Không tải được tài liệu",
        );
      });

    return () => controller.abort();
  }, [selectedId, attempt, loaded]);

  // Proactive refresh a minute before the signature dies.
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(
      () => setAttempt((value) => value + 1),
      msUntilRefresh(current.expiresAt),
    );
    return () => clearTimeout(timer);
  }, [current]);

  const handleSignatureExpired = useCallback(() => {
    if (retries.current >= MAX_AUTO_RETRIES) return;
    retries.current += 1;
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  const selectFile = (fileId: string) => {
    if (fileId === selectedId) return;
    retries.current = 0;
    setError(null);
    setSelectedId(fileId);
  };

  if (files.length === 0) {
    return (
      <div className="flex h-full min-h-[28rem] flex-col items-center justify-center rounded-xl border bg-card p-6 shadow-sm">
        <EmptyState
          icon={<FileQuestion className="h-6 w-6" />}
          title="Chưa có tài liệu đính kèm"
          description="Hợp đồng này chưa có tệp nào được tải lên hoặc các tệp đã bị xoá."
          className="border-0 shadow-none"
        />
        {contractId && (
          <Button
            type="button"
            className="mt-4"
            onClick={() => {
              setReplacingFile(null);
              setUploadModalOpen(true);
            }}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            Tải lên tài liệu
          </Button>
        )}
        {contractId && (
          <UploadContractFileDialog
            contractId={contractId}
            open={uploadModalOpen}
            onOpenChange={setUploadModalOpen}
            onSuccess={() => router.refresh()}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-xl border bg-card shadow-sm lg:flex-row">
      <DocumentSelector
        files={files}
        selectedId={selectedId}
        onSelect={selectFile}
        disabled={loading || isDeleting}
        onAddFile={
          contractId && !readOnly
            ? () => {
                setReplacingFile(null);
                setUploadModalOpen(true);
              }
            : undefined
        }
        onDeleteFile={contractId && canDelete && !readOnly ? handleDeleteFile : undefined}
        onDownloadFile={handleDownloadFile}
      />

      <div className="min-h-0 min-w-0 flex-1">
        {error ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertTitle>Không xem được tài liệu</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{formatPdfErrorMessage(error)}</p>
                <div className="flex flex-wrap gap-2">
                  {contractId && selected && canDelete && !readOnly && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setReplacingFile({ id: selected.id, name: selected.original_filename });
                        setUploadModalOpen(true);
                      }}
                    >
                      <Upload className="mr-1.5 h-4 w-4" />
                      Tải lên tệp thay thế
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSignatureExpired}
                  >
                    Thử lại
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        ) : loading || !current || !selected ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải tài liệu...
          </div>
        ) : isPdfMime(selected.mime_type) ? (
          <ViewerErrorBoundary onRetry={handleSignatureExpired}>
            <PdfPanel
              url={current.viewUrl}
              fileName={selected.original_filename}
              onSignatureExpired={handleSignatureExpired}
              onUploadReplacement={
                contractId && selected && canDelete && !readOnly
                  ? () => {
                      setReplacingFile({ id: selected.id, name: selected.original_filename });
                      setUploadModalOpen(true);
                    }
                  : undefined
              }
            />
          </ViewerErrorBoundary>
        ) : isImageMime(selected.mime_type) ? (
          <ImageViewer url={current.viewUrl} alt={selected.original_filename} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Định dạng {selected.mime_type} chưa được hỗ trợ xem trước.
          </div>
        )}
      </div>

      {contractId && !readOnly && (
        <UploadContractFileDialog
          contractId={contractId}
          open={uploadModalOpen}
          onOpenChange={setUploadModalOpen}
          replacingFileId={replacingFile?.id}
          replacingFileName={replacingFile?.name}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  );
}
